/**
 * WAT-9 — Presentation → Lesson conversion engine (server-side, in the Worker).
 *
 * POST /api/lessons/convert turns an AhaSlides presentation into a self-paced
 * Lesson of interleaved question/explanation slides:
 *
 *   1. Fetch the presentation detail (titles, body text, speaker notes — image
 *      content is skipped) via the presenter API.
 *   2. Ask a Workers AI instruct model to generate up to 10 grounded
 *      multiple-choice questions (4 options, exactly 1 correct) + a 2–4 sentence
 *      explanation each, in the SAME LANGUAGE as the source deck, using ONLY
 *      facts present in the extracted text.
 *   3. Validate/repair the model output (exactly 4 options, exactly 1 correct,
 *      explanation length, non-empty); retry once if malformed.
 *   4. Persist as ONE `lessons` row + 2N `lesson_slides` rows interleaved
 *      Q1,E1,…,Qn,En (the NEW NORMALIZED Courses model from WAT-8 — NOT the
 *      legacy `lessons.slides` JSON blob).
 *   5. Return { lesson_id, question_count, warning? }.
 *
 * Rules (from the WAT-9 brief):
 *   - Output language matches the source presentation.
 *   - No facts introduced beyond the presentation content.
 *   - < 3 content slides  → 4xx error.
 *   - Can support < 10 questions → generate as many as possible (min 3) and
 *     attach a `warning`.
 *
 * TESTABILITY: the pure orchestrator `buildAndSaveLesson` takes its presenter
 * fetch and AI call as INJECTED callbacks (`fetchSlides`, `runAi`), so worker
 * integration tests drive it deterministically with mocks (no network, no AI
 * spend) while the live route wires the real implementations below.
 *
 * RELATIONSHIP TO WAT-1 (flagged): the existing CLIENT-side converter
 * (src/lessons + ConverterModal) EXTRACTS a deck's existing pick-answer slides
 * verbatim into the legacy `lessons.slides` blob. THIS endpoint is different:
 * it GENERATES new comprehension questions with AI and writes the normalized
 * model. The two are complementary, not duplicates; convergence is a later
 * decision (see migration 0003 duality flag).
 */

// ── Tunables ────────────────────────────────────────────────────────────────

/** The Workers AI model used for generation (capable, multilingual instruct). */
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

/** Target number of questions; fewer is allowed (min 3) with a warning. */
export const TARGET_QUESTIONS = 10

/** Minimum questions; below this we error instead of producing a weak lesson. */
export const MIN_QUESTIONS = 3

/** Minimum content slides required to attempt a conversion. */
export const MIN_CONTENT_SLIDES = 3

/** Bounded AI retries when output is malformed/insufficient. */
const MAX_AI_ATTEMPTS = 2

/**
 * The frontend's dev token (account id 42757) — server-side fallback for NOW so
 * the endpoint is testable without per-user auth. A later stage wires the real
 * per-user token. Flagged in the WAT-9 reply.
 */
export const DEV_PRESENTER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI3NTcsImlhdCI6MTc3OTI3NTUyMywiZXhwIjoxODQyMzQ3NTIzfQ.iVJ3bRoDOJ4mTag8DeBAEG3nujfYNK2vVWSH6pgxtLc'

const PRESENTER_API_BASE = 'https://presenter.dev.ahaslide.com'

// ── Types ───────────────────────────────────────────────────────────────────

/** A raw slide as returned inside the presentation-detail `Slides` array. */
export interface RawSlide {
  id?: number
  type?: string
  slideType?: string | null
  title?: string | null
  titleHTML?: string | null
  bodyHTML?: string | null
  subheading?: string | null
  titleDesc?: string | null
  description?: string | null
  notes?: string | null
  order?: number
  SlideOptions?: Array<{ title?: string | null; correct?: boolean }> | null
  [key: string]: unknown
}

/** The minimal presentation-detail shape this module reads. */
export interface PresentationDetail {
  name?: string | null
  title?: string | null
  language?: string | null
  Slides?: RawSlide[]
}

/** Extracted, image-free text for one content slide. */
export interface ContentSlide {
  order: number
  title: string
  body: string
  notes: string
  options: string[]
}

/** One validated AI-generated question + explanation. */
export interface GeneratedQuestion {
  question: string
  options: string[]
  correct_index: number
  explanation: string
}

/** Injected dependencies (real impls below; mocks in tests). */
export interface ConvertDeps {
  /** Fetch the presentation detail (titles/body/notes + language). */
  fetchSlides: (presentationId: string, token: string) => Promise<PresentationDetail>
  /**
   * Run the instruct model with a prompt; returns the raw response. Workers AI
   * may return a JSON string OR an already-parsed object — both are accepted by
   * the parser, so this is intentionally `unknown`.
   */
  runAi: (prompt: string) => Promise<unknown>
}

export interface ConvertOptions {
  presentationId: string
  /** Presenter token (request-supplied or the dev fallback). */
  token: string
}

export interface ConvertResult {
  lesson_id: string
  question_count: number
  warning?: string
}

/** A typed conversion error carrying an HTTP status. */
export class ConvertError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ConvertError'
  }
}

// ── Text extraction (image content skipped) ──────────────────────────────────

/** Strip HTML tags + collapse whitespace; returns a trimmed plain string. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract usable text from a presentation's slides, in display order. A slide
 * contributes a ContentSlide only when it has usable text (title / body / notes
 * / at least one option with text). Pure image/media slides are skipped.
 */
export function extractContentSlides(slides: RawSlide[]): ContentSlide[] {
  const out: ContentSlide[] = []
  for (const s of slides) {
    const title =
      stripHtml(s.title) ||
      stripHtml(s.titleHTML) ||
      stripHtml(s.subheading)
    const body =
      stripHtml(s.bodyHTML) ||
      stripHtml(s.titleDesc) ||
      stripHtml(s.description)
    const notes = stripHtml(s.notes)
    const options = (s.SlideOptions ?? [])
      .map((o) => stripHtml(o?.title))
      .filter((t) => t.length > 0)

    const hasText =
      title.length > 0 || body.length > 0 || notes.length > 0 || options.length > 0
    if (!hasText) continue

    out.push({
      order: typeof s.order === 'number' ? s.order : out.length,
      title,
      body,
      notes,
      options,
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

/** Render extracted content slides into a compact, prompt-friendly text block. */
export function renderContentForPrompt(content: ContentSlide[]): string {
  return content
    .map((c, i) => {
      const lines: string[] = [`Slide ${i + 1}:`]
      if (c.title) lines.push(`Title: ${c.title}`)
      if (c.body) lines.push(`Body: ${c.body}`)
      if (c.notes) lines.push(`Speaker notes: ${c.notes}`)
      if (c.options.length) lines.push(`Options: ${c.options.join('; ')}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

// ── Prompt + AI output parsing/validation ─────────────────────────────────────

/** Build the strict-grounding generation prompt. */
export function buildPrompt(
  content: ContentSlide[],
  numQuestions: number,
  languageHint: string | null,
): string {
  const langLine = languageHint
    ? `The source language code is "${languageHint}". Write ALL output in that language.`
    : `Detect the language of the content below and write ALL output in that SAME language.`

  return [
    `You are an instructional designer. Create a multiple-choice quiz from the presentation content below.`,
    ``,
    `STRICT RULES:`,
    `1. Use ONLY facts that are explicitly present in the content. Do NOT invent, infer beyond, or add outside knowledge.`,
    `2. ${langLine}`,
    `3. Produce EXACTLY ${numQuestions} questions (no more, no fewer).`,
    `4. Each question MUST have EXACTLY 4 options and EXACTLY 1 correct option.`,
    `5. For each question include a 2-4 short-sentence "explanation" drawn from the content.`,
    `6. Questions must be answerable from the content alone. Make distractors plausible but clearly wrong per the content.`,
    ``,
    `Return ONLY valid JSON, no prose, with this exact shape:`,
    `{"questions":[{"question":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"..."}]}`,
    `"correct_index" is the 0-based index (0..3) of the correct option.`,
    ``,
    `PRESENTATION CONTENT:`,
    renderContentForPrompt(content),
  ].join('\n')
}

/** Best-effort extraction of the first JSON object from a model response. */
export function extractJson(raw: unknown): unknown {
  // Workers AI returns `response` as a string MOST of the time, but for some
  // models / JSON-shaped outputs it hands back an already-parsed object. Accept
  // both: if it's already an object, use it directly.
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string' || !raw) return null
  // Strip ```json fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  // Find the outermost {...} span.
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

/**
 * Validate + normalize one candidate question. Returns a clean
 * GeneratedQuestion or null if it can't be salvaged.
 */
export function validateQuestion(raw: unknown): GeneratedQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const question = typeof r.question === 'string' ? r.question.trim() : ''
  if (!question) return null

  let options = Array.isArray(r.options)
    ? r.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)
    : []
  // Dedupe (case-insensitive) — models sometimes repeat an option.
  const seen = new Set<string>()
  options = options.filter((o) => {
    const k = o.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (options.length !== 4) return null

  const idx =
    typeof r.correct_index === 'number'
      ? r.correct_index
      : Number(r.correct_index)
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return null

  let explanation =
    typeof r.explanation === 'string' ? r.explanation.trim() : ''
  if (!explanation) return null
  // Cap runaway explanations to keep them "2-4 short sentences".
  const sentences = explanation
    .split(/(?<=[.!?。！？])\s+/)
    .filter((s) => s.trim().length > 0)
  if (sentences.length > 4) explanation = sentences.slice(0, 4).join(' ')

  return { question, options, correct_index: idx, explanation }
}

/** Parse + validate a full AI response into an array of clean questions. */
export function parseAiQuestions(raw: unknown): GeneratedQuestion[] {
  const obj = extractJson(raw)
  if (!obj) return []
  const arr = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as Record<string, unknown>).questions)
      ? ((obj as Record<string, unknown>).questions as unknown[])
      : []
  const out: GeneratedQuestion[] = []
  for (const c of arr) {
    const v = validateQuestion(c)
    if (v) out.push(v)
  }
  return out
}

/**
 * Generate questions via the injected AI runner, with bounded retries. Aims for
 * `target` questions; returns as many valid ones as the model produces.
 */
export async function generateQuestions(
  runAi: (prompt: string) => Promise<unknown>,
  content: ContentSlide[],
  target: number,
  languageHint: string | null,
): Promise<GeneratedQuestion[]> {
  let best: GeneratedQuestion[] = []
  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(content, target, languageHint)
    let raw: unknown = ''
    try {
      raw = await runAi(prompt)
    } catch {
      raw = ''
    }
    const questions = parseAiQuestions(raw)
    if (questions.length > best.length) best = questions
    if (best.length >= target) break
  }
  return best.slice(0, target)
}

// ── Persistence (normalized Lesson + LessonSlide model) ──────────────────────

/** Pick a lesson title from the deck name, with a sane fallback. */
export function lessonTitle(detail: PresentationDetail): string {
  const name = stripHtml(detail.name) || stripHtml(detail.title)
  return name || 'Untitled lesson'
}

/**
 * Orchestrate the whole conversion with INJECTED deps, then persist. Throws
 * ConvertError for the <3-content-slides and <3-question cases.
 */
export async function buildAndSaveLesson(
  db: D1Database,
  deps: ConvertDeps,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const detail = await deps.fetchSlides(opts.presentationId, opts.token)
  const slides = Array.isArray(detail.Slides) ? detail.Slides : []
  const content = extractContentSlides(slides)

  if (content.length < MIN_CONTENT_SLIDES) {
    throw new ConvertError(
      `Presentation has only ${content.length} content slide(s); need at least ${MIN_CONTENT_SLIDES} to build a lesson.`,
      422,
    )
  }

  // A deck with few content slides can't support 10 grounded questions; cap the
  // ask to what the content can plausibly support (1 question per content slide
  // is a reasonable ceiling) so we don't push the model to invent facts.
  const target = Math.min(TARGET_QUESTIONS, Math.max(content.length, MIN_QUESTIONS))

  const language = detail.language ?? null
  const questions = await generateQuestions(deps.runAi, content, target, language)

  if (questions.length < MIN_QUESTIONS) {
    throw new ConvertError(
      `Could not generate at least ${MIN_QUESTIONS} grounded questions from this presentation (got ${questions.length}).`,
      422,
    )
  }

  const questionCount = Math.min(questions.length, TARGET_QUESTIONS)
  const chosen = questions.slice(0, questionCount)

  let warning: string | undefined
  if (questionCount < TARGET_QUESTIONS) {
    warning = `Generated ${questionCount} of ${TARGET_QUESTIONS} questions — the presentation content only supported ${questionCount}.`
  }

  // ── Persist: one lessons row + 2N interleaved lesson_slides rows ───────────
  const lessonId = crypto.randomUUID()
  const now = new Date().toISOString()
  const title = lessonTitle(detail)
  // 20 slides for 10 questions; ~ a slide every ~30s → derive a rough estimate.
  const slideCount = chosen.length * 2
  const estimatedMinutes = Math.max(1, Math.round(slideCount * 0.5))
  const presIdNum = Number(opts.presentationId)
  const sourcePresentationId = Number.isFinite(presIdNum) ? presIdNum : null

  // Insert the lessons row. We also seed the legacy not-null columns
  // (presentation_id, slides, description) so the row satisfies the 0002 schema
  // while the normalized lesson_slides rows are the source of truth for Courses.
  await db
    .prepare(
      `INSERT INTO lessons
         (id, presentation_id, title, description, slides, status,
          created_at, updated_at, published_at,
          owner_id, source_presentation_id, estimated_duration_minutes, language)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      lessonId,
      sourcePresentationId ?? 0,
      title,
      '',
      '[]',
      now,
      now,
      sourcePresentationId,
      estimatedMinutes,
      language,
    )
    .run()

  // Build interleaved Q1,E1,…,Qn,En lesson_slides rows.
  const statements: D1PreparedStatement[] = []
  const insert = db.prepare(
    `INSERT INTO lesson_slides (id, lesson_id, "order", type, content)
     VALUES (?, ?, ?, ?, ?)`,
  )
  let order = 0
  for (const q of chosen) {
    const questionContent = JSON.stringify({
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
    })
    statements.push(
      insert.bind(crypto.randomUUID(), lessonId, order++, 'question', questionContent),
    )
    const explanationContent = JSON.stringify({ explanation: q.explanation })
    statements.push(
      insert.bind(crypto.randomUUID(), lessonId, order++, 'explanation', explanationContent),
    )
  }
  await db.batch(statements)

  return warning
    ? { lesson_id: lessonId, question_count: questionCount, warning }
    : { lesson_id: lessonId, question_count: questionCount }
}

// ── Regeneration helpers (WAT-11) ────────────────────────────────────────────
//
// WAT-11 lets the trainer regenerate the WHOLE lesson or just ONE question+
// explanation pair from the source presentation, honoring the same grounding
// and language rules as the original convert (WAT-9). Both reuse the pieces
// above (fetch → extract → prompt → validate); the persistence differs because
// the lesson row already exists.

/**
 * Load the source presentation's extracted content + language for a lesson that
 * was produced by convert. Throws ConvertError if the lesson has no source
 * presentation or the deck can't be fetched / has too little content.
 */
export async function loadSourceContent(
  deps: ConvertDeps,
  presentationId: string,
  token: string,
): Promise<{ content: ContentSlide[]; language: string | null }> {
  const detail = await deps.fetchSlides(presentationId, token)
  const slides = Array.isArray(detail.Slides) ? detail.Slides : []
  const content = extractContentSlides(slides)
  if (content.length < MIN_CONTENT_SLIDES) {
    throw new ConvertError(
      `Source presentation has only ${content.length} content slide(s); need at least ${MIN_CONTENT_SLIDES}.`,
      422,
    )
  }
  return { content, language: detail.language ?? null }
}

/**
 * Regenerate the WHOLE lesson in place: re-run generation from the source deck
 * and REPLACE all lesson_slides rows + refresh the lesson's slide-count-derived
 * estimated_duration_minutes. The lesson id, title and ownership are preserved.
 * Returns the new question count (+ warning if fewer than target).
 */
export async function regenerateLessonAll(
  db: D1Database,
  deps: ConvertDeps,
  lessonId: string,
  presentationId: string,
  token: string,
): Promise<ConvertResult> {
  const { content, language } = await loadSourceContent(deps, presentationId, token)
  const target = Math.min(TARGET_QUESTIONS, Math.max(content.length, MIN_QUESTIONS))
  const questions = await generateQuestions(deps.runAi, content, target, language)

  if (questions.length < MIN_QUESTIONS) {
    throw new ConvertError(
      `Could not regenerate at least ${MIN_QUESTIONS} grounded questions from this presentation (got ${questions.length}).`,
      422,
    )
  }

  const questionCount = Math.min(questions.length, TARGET_QUESTIONS)
  const chosen = questions.slice(0, questionCount)
  let warning: string | undefined
  if (questionCount < TARGET_QUESTIONS) {
    warning = `Generated ${questionCount} of ${TARGET_QUESTIONS} questions — the presentation content only supported ${questionCount}.`
  }

  const now = new Date().toISOString()
  const slideCount = chosen.length * 2
  const estimatedMinutes = Math.max(1, Math.round(slideCount * 0.5))

  // Replace all existing slides, then re-seed interleaved Q1,E1,…
  await db.prepare(`DELETE FROM lesson_slides WHERE lesson_id = ?`).bind(lessonId).run()

  const statements: D1PreparedStatement[] = []
  const insert = db.prepare(
    `INSERT INTO lesson_slides (id, lesson_id, "order", type, content)
     VALUES (?, ?, ?, ?, ?)`,
  )
  let order = 0
  for (const q of chosen) {
    statements.push(
      insert.bind(
        crypto.randomUUID(),
        lessonId,
        order++,
        'question',
        JSON.stringify({ question: q.question, options: q.options, correct_index: q.correct_index }),
      ),
    )
    statements.push(
      insert.bind(
        crypto.randomUUID(),
        lessonId,
        order++,
        'explanation',
        JSON.stringify({ explanation: q.explanation }),
      ),
    )
  }
  statements.push(
    db
      .prepare(
        `UPDATE lessons
            SET estimated_duration_minutes = ?, language = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(estimatedMinutes, language, now, lessonId),
  )
  await db.batch(statements)

  return warning
    ? { lesson_id: lessonId, question_count: questionCount, warning }
    : { lesson_id: lessonId, question_count: questionCount }
}

/**
 * Generate ONE fresh grounded question + explanation from the source deck.
 * Asks the model for a small batch (so it has room to produce a valid one) and
 * returns the first valid question. Throws ConvertError if none can be made.
 */
export async function regenerateOneQuestion(
  deps: ConvertDeps,
  presentationId: string,
  token: string,
): Promise<GeneratedQuestion> {
  const { content, language } = await loadSourceContent(deps, presentationId, token)
  // Ask for a few so the validator has a salvageable candidate even if the
  // model fumbles one; we keep only the first valid question.
  const want = Math.min(3, Math.max(1, content.length))
  const questions = await generateQuestions(deps.runAi, content, want, language)
  if (!questions.length) {
    throw new ConvertError(
      'Could not regenerate a grounded question from this presentation.',
      422,
    )
  }
  return questions[0]
}

// ── Real implementations (live route wiring) ─────────────────────────────────

/** Fetch the presentation detail from the presenter API. */
export async function fetchPresentationDetail(
  presentationId: string,
  token: string,
): Promise<PresentationDetail> {
  const res = await fetch(
    `${PRESENTER_API_BASE}/api/presentation/detail/${encodeURIComponent(presentationId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? res.status : 502
    throw new ConvertError(
      res.status === 401 || res.status === 403
        ? 'Unauthorized — the presenter token is invalid or expired.'
        : `Failed to load presentation ${presentationId} (${res.status}).`,
      status,
    )
  }
  return (await res.json()) as PresentationDetail
}

/**
 * Run the Workers AI instruct model and return its raw `response`. That value
 * may be a JSON STRING or an already-parsed OBJECT depending on the model /
 * output — the parser (`parseAiQuestions`) accepts both.
 */
export async function runWorkersAi(ai: Ai, prompt: string): Promise<unknown> {
  const result = (await ai.run(AI_MODEL as never, {
    messages: [
      {
        role: 'system',
        content:
          'You output only valid JSON matching the requested schema. No markdown, no commentary.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  } as never)) as { response?: unknown } | string
  if (typeof result === 'string') return result
  return result?.response ?? ''
}

/**
 * Resolve the presenter token from the request (Authorization: Bearer … or a
 * `token` body field), falling back to the server-side dev token.
 */
export function resolvePresenterToken(
  authHeader: string | null,
  bodyToken: unknown,
): string {
  const fromHeader = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (fromHeader) return fromHeader
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim()
  return DEV_PRESENTER_TOKEN
}
