/**
 * Waterloo Worker — serves the Vue SPA (static assets) and the backend API.
 *
 * Routing (see wrangler.jsonc):
 *   - `/api/*`        → handled here (run_worker_first).
 *   - everything else → served from ./dist as a static asset, with
 *     single-page-application fallback to index.html. Those requests don't
 *     normally reach this Worker; the env.ASSETS.fetch() below is a safety net.
 *
 * API (all JSON in/out):
 *   - GET    /api/health
 *   - GET    /api/lessons                      → list lessons (newest first).
 *   - GET    /api/lessons/:id                  → one lesson, or 404.
 *   - PUT    /api/lessons/:id                  → upsert (save draft); returns it.
 *   - DELETE /api/lessons/:id                  → delete a lesson.
 *   - POST   /api/lessons/:id/publish          → status=published + publishedAt.
 *   - POST   /api/lessons/:lessonId/attempts   → insert ONE attempt; returns it.
 *   - GET    /api/lessons/:lessonId/attempts   → all attempts for a lesson,
 *                                                newest first (for the report).
 *
 * Lessons (WAT-3) AND attempts (WAT-5) are persisted in D1 (`env.DB`). Lessons
 * are the source of truth for the editor + audience; the whole slide array is
 * stored as an opaque JSON blob (slide-type-defined shapes). Attempts allow
 * multiple rows per lesson (no dedupe); each carries a self-contained per-slide
 * `responses` snapshot so the report renders from D1 alone.
 */

import {
  ConvertError,
  MIN_QUESTIONS,
  buildAndSaveLesson,
  fetchPresentationDetail,
  regenerateLessonAll,
  regenerateOneQuestion,
  resolvePresenterToken,
  runWorkersAi,
} from './lessons-convert'

/** One per-slide snapshot inside an attempt's `responses` array. */
interface AttemptResponse {
  /** The lesson slide id (source presenter slide id). */
  slideId: number
  /** The slide-type key, e.g. 'pickAnswer'. */
  type: string
  /** Human-readable question/title snapshot for the report. */
  question: string
  /** The audience's answer payload (slide-type-defined; may be null). */
  response: unknown
  /** Whether this response was correct (slide-type-defined; may be null). */
  correct: boolean | null
}

/** The DB row shape for an attempt (responses stored as JSON text). */
interface AttemptRow {
  id: string
  lesson_id: string
  audience_name: string | null
  score: number
  total: number
  responses: string
  created_at: string
}

/** The attempt shape returned by the API (responses parsed into an array). */
interface Attempt {
  id: string
  lessonId: string
  audienceName: string | null
  score: number
  total: number
  responses: AttemptResponse[]
  createdAt: string
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

/** Map a DB row → API attempt (parse the JSON responses snapshot). */
function rowToAttempt(row: AttemptRow): Attempt {
  let responses: AttemptResponse[] = []
  try {
    const parsed = JSON.parse(row.responses)
    if (Array.isArray(parsed)) responses = parsed as AttemptResponse[]
  } catch {
    responses = []
  }
  return {
    id: row.id,
    lessonId: row.lesson_id,
    audienceName: row.audience_name,
    score: row.score,
    total: row.total,
    responses,
    createdAt: row.created_at,
  }
}

/** Coerce + validate the incoming responses array; drops malformed entries. */
function sanitizeResponses(input: unknown): AttemptResponse[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      slideId: typeof r.slideId === 'number' ? r.slideId : 0,
      type: typeof r.type === 'string' ? r.type : 'unknown',
      question: typeof r.question === 'string' ? r.question : '',
      response: r.response ?? null,
      correct: typeof r.correct === 'boolean' ? r.correct : null,
    }))
}

/** POST /api/lessons/:lessonId/attempts — insert one attempt. */
async function createAttempt(
  env: Env,
  lessonId: string,
  request: Request,
): Promise<Response> {
  if (!lessonId) return json({ error: 'Missing lessonId' }, 400)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const responses = sanitizeResponses(body.responses)
  const rawName = typeof body.audienceName === 'string' ? body.audienceName.trim() : ''
  const audienceName = rawName ? rawName.slice(0, 120) : null
  const total =
    typeof body.total === 'number' && body.total >= 0
      ? Math.floor(body.total)
      : responses.length
  const score =
    typeof body.score === 'number' && body.score >= 0 ? Math.floor(body.score) : 0

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO attempts
       (id, lesson_id, audience_name, score, total, responses, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, lessonId, audienceName, score, total, JSON.stringify(responses), createdAt)
    .run()

  const attempt: Attempt = {
    id,
    lessonId,
    audienceName,
    score,
    total,
    responses,
    createdAt,
  }
  return json({ attempt }, 201)
}

/** GET /api/lessons/:lessonId/attempts — all attempts for a lesson, newest first. */
async function listAttempts(env: Env, lessonId: string): Promise<Response> {
  if (!lessonId) return json({ error: 'Missing lessonId' }, 400)

  const { results } = await env.DB.prepare(
    `SELECT id, lesson_id, audience_name, score, total, responses, created_at
       FROM attempts
      WHERE lesson_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(lessonId)
    .all<AttemptRow>()

  const attempts = (results ?? []).map(rowToAttempt)
  return json({ attempts })
}

// ── Lessons (WAT-3) ──────────────────────────────────────────────────────────

type LessonStatus = 'draft' | 'published'

/** The DB row shape for a lesson (slides stored as JSON text). */
interface LessonRow {
  id: string
  presentation_id: number
  title: string
  description: string
  slides: string
  status: string
  created_at: string
  updated_at: string
  published_at: string | null
}

/** The lesson shape returned by the API (slides parsed into an array). */
interface Lesson {
  id: string
  presentationId: number
  title: string
  description: string
  slides: unknown[]
  status: LessonStatus
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

/** Map a DB row → API lesson (parse the JSON slides blob). */
function rowToLesson(row: LessonRow): Lesson {
  let slides: unknown[] = []
  try {
    const parsed = JSON.parse(row.slides)
    if (Array.isArray(parsed)) slides = parsed
  } catch {
    slides = []
  }
  return {
    id: row.id,
    presentationId: row.presentation_id,
    title: row.title,
    description: row.description,
    slides,
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }
}

/** GET /api/lessons — all lessons, newest-updated first. */
async function listLessons(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, presentation_id, title, description, slides, status,
            created_at, updated_at, published_at
       FROM lessons
      ORDER BY updated_at DESC`,
  ).all<LessonRow>()
  return json({ lessons: (results ?? []).map(rowToLesson) })
}

/** GET /api/lessons/:id — one lesson, or 404. */
async function getLesson(env: Env, id: string): Promise<Response> {
  if (!id) return json({ error: 'Missing lesson id' }, 400)
  const row = await env.DB.prepare(
    `SELECT id, presentation_id, title, description, slides, status,
            created_at, updated_at, published_at
       FROM lessons WHERE id = ?`,
  )
    .bind(id)
    .first<LessonRow>()
  if (!row) return json({ error: 'Lesson not found' }, 404)
  return json({ lesson: rowToLesson(row) })
}

/**
 * PUT /api/lessons/:id — upsert (save draft). Creates the lesson if new;
 * updates title/description/slides + bumps updated_at if it exists, preserving
 * the existing status/created_at/published_at (publishing is a separate route).
 */
async function upsertLesson(
  env: Env,
  id: string,
  request: Request,
): Promise<Response> {
  if (!id) return json({ error: 'Missing lesson id' }, 400)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title : ''
  const description =
    typeof body.description === 'string' ? body.description : ''
  const presentationId =
    typeof body.presentationId === 'number' ? Math.floor(body.presentationId) : 0
  const slides = Array.isArray(body.slides) ? body.slides : []
  const slidesJson = JSON.stringify(slides)
  const now = new Date().toISOString()

  const existing = await env.DB.prepare(
    `SELECT id, status, created_at FROM lessons WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; status: string; created_at: string }>()

  if (existing) {
    await env.DB.prepare(
      `UPDATE lessons
          SET presentation_id = ?, title = ?, description = ?, slides = ?,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(presentationId, title, description, slidesJson, now, id)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO lessons
         (id, presentation_id, title, description, slides, status,
          created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
    )
      .bind(id, presentationId, title, description, slidesJson, now, now)
      .run()
  }

  return getLesson(env, id)
}

/** DELETE /api/lessons/:id. */
async function deleteLesson(env: Env, id: string): Promise<Response> {
  if (!id) return json({ error: 'Missing lesson id' }, 400)
  await env.DB.prepare(`DELETE FROM lessons WHERE id = ?`).bind(id).run()
  return json({ ok: true })
}

/** POST /api/lessons/:id/publish — status=published + publishedAt. */
async function publishLesson(env: Env, id: string): Promise<Response> {
  if (!id) return json({ error: 'Missing lesson id' }, 400)
  const now = new Date().toISOString()
  const res = await env.DB.prepare(
    `UPDATE lessons
        SET status = 'published', published_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(now, now, id)
    .run()
  // D1 reports affected rows in meta.changes.
  if (!res.meta || (res.meta.changes ?? 0) === 0) {
    return json({ error: 'Lesson not found' }, 404)
  }
  return getLesson(env, id)
}

// ── Lesson conversion (WAT-9) ────────────────────────────────────────────────
//
// POST /api/lessons/convert — AI-generate a Lesson from an AhaSlides
// presentation and persist it into the NORMALIZED Courses model (a `lessons`
// row + interleaved `lesson_slides` rows), NOT the legacy `lessons.slides`
// blob. See worker/lessons-convert.ts for the full pipeline + flagged
// decisions (presenter-token source, WAT-1 relationship).

/** POST /api/lessons/convert — body: { presentation_id, token? }. */
async function convertLesson(env: Env, request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const presentationId =
    typeof body.presentation_id === 'number'
      ? String(body.presentation_id)
      : typeof body.presentation_id === 'string'
        ? body.presentation_id.trim()
        : ''
  if (!presentationId) {
    return json({ error: 'Missing presentation_id' }, 400)
  }

  const token = resolvePresenterToken(
    request.headers.get('authorization'),
    body.token,
  )

  try {
    const result = await buildAndSaveLesson(
      env.DB,
      {
        fetchSlides: fetchPresentationDetail,
        runAi: (prompt) => runWorkersAi(env.AI, prompt),
      },
      { presentationId, token },
    )
    return json(result, 201)
  } catch (err) {
    if (err instanceof ConvertError) {
      return json({ error: err.message }, err.status)
    }
    return json(
      { error: 'Conversion failed', detail: String((err as Error)?.message ?? err) },
      500,
    )
  }
}

// ── Courses (WAT-8 / WAT-10) ────────────────────────────────────────────────
//
// WAT-8 added stub routes (501) for the Course-container surface.
// WAT-10 implements GET /api/courses/lessons — a list of NORMALIZED lessons
// (i.e. lessons rows that have associated lesson_slides created by the WAT-9
// AI convert pipeline). This endpoint powers the /courses home page.
//
// The Course-container /api/courses routes remain stubs until a later stage
// wires them; they continue to return 501.
//
// NOTE: none of this touches the existing /api/lessons routes.

/** A consistent 501 stub response for not-yet-implemented Courses endpoints. */
function coursesStub(route: string): Response {
  return json(
    { error: 'Not Implemented', todo: `WAT-8 stub — ${route} not implemented yet` },
    501,
  )
}

// DB row shape for the normalized lesson list query.
interface NormalizedLessonRow {
  id: string
  source_presentation_id: number | null
  title: string
  status: string
  created_at: string
  estimated_duration_minutes: number | null
  language: string | null
  slide_count: number
}

/**
 * GET /api/courses/lessons — list normalized lessons (WAT-10).
 *
 * Returns lessons that were created by the WAT-9 AI convert pipeline, newest
 * first by created_at. A lesson is "normalized" when it has at least one
 * lesson_slides row (the AI convert pipeline always creates them). Legacy
 * JSON-blob lessons that have zero lesson_slides rows are excluded.
 *
 * Response: { lessons: NormalizedLesson[] }
 */
async function listNormalizedLessons(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       l.id,
       l.source_presentation_id,
       l.title,
       l.status,
       l.created_at,
       l.estimated_duration_minutes,
       l.language,
       COUNT(ls.id) AS slide_count
     FROM lessons l
     INNER JOIN lesson_slides ls ON ls.lesson_id = l.id
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
  ).all<NormalizedLessonRow>()

  const lessons = (results ?? []).map((r) => ({
    id: r.id,
    sourcePresentationId: r.source_presentation_id,
    title: r.title,
    status: r.status === 'published' ? 'published' : 'draft',
    createdAt: r.created_at,
    estimatedDurationMinutes: r.estimated_duration_minutes,
    language: r.language,
    slideCount: r.slide_count,
  }))

  return json({ lessons })
}

// ── Lesson detail / editor (WAT-11) ──────────────────────────────────────────
//
// The trainer reviews + edits an AI-converted lesson before publishing. The
// lesson is the NORMALIZED model: one `lessons` row + interleaved
// `lesson_slides` rows (Q1,E1,…,Qn,En). All routes below operate on that model.
//
//   GET   /api/courses/lessons/:id                         → lesson + slides
//   PATCH /api/courses/lessons/:id                         → save title/duration/slides
//   POST  /api/courses/lessons/:id/reorder                 → reorder Q+E pairs
//   DELETE/api/courses/lessons/:id/questions/:order        → delete a Q+E pair (min 3)
//   POST  /api/courses/lessons/:id/questions/:order/regenerate → regen one Q+E
//   POST  /api/courses/lessons/:id/regenerate              → regen the whole lesson
//   POST  /api/courses/lessons/:id/reviewed                → mark reviewed=1

/** Minimum questions a lesson must keep (mirrors the convert pipeline floor). */
const MIN_LESSON_QUESTIONS = MIN_QUESTIONS

interface LessonSlideRow {
  id: string
  lesson_id: string
  order: number
  type: string
  content: string
}

interface DetailLessonRow {
  id: string
  title: string
  status: string
  source_presentation_id: number | null
  estimated_duration_minutes: number | null
  language: string | null
  reviewed: number | null
  created_at: string
  updated_at: string
}

function parseContent(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Load a normalized lesson + its ordered slides; null if the lesson is absent. */
async function loadLessonDetail(
  env: Env,
  id: string,
): Promise<{ lesson: DetailLessonRow; slides: LessonSlideRow[] } | null> {
  const lesson = await env.DB.prepare(
    `SELECT id, title, status, source_presentation_id,
            estimated_duration_minutes, language, reviewed, created_at, updated_at
       FROM lessons WHERE id = ?`,
  )
    .bind(id)
    .first<DetailLessonRow>()
  if (!lesson) return null

  const { results } = await env.DB.prepare(
    `SELECT id, lesson_id, "order", type, content
       FROM lesson_slides WHERE lesson_id = ? ORDER BY "order" ASC`,
  )
    .bind(id)
    .all<LessonSlideRow>()
  return { lesson, slides: results ?? [] }
}

/** Serialize a lesson + slides into the API shape. */
function lessonDetailBody(lesson: DetailLessonRow, slides: LessonSlideRow[]) {
  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      status: lesson.status === 'published' ? 'published' : 'draft',
      sourcePresentationId: lesson.source_presentation_id,
      estimatedDurationMinutes: lesson.estimated_duration_minutes,
      language: lesson.language,
      reviewed: !!lesson.reviewed,
      createdAt: lesson.created_at,
      updatedAt: lesson.updated_at,
    },
    slides: slides.map((s) => ({
      id: s.id,
      order: s.order,
      type: s.type === 'question' ? 'question' : 'explanation',
      content: parseContent(s.content),
    })),
  }
}

/** GET /api/courses/lessons/:id — normalized lesson + ordered slides. */
async function getLessonDetail(env: Env, id: string): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)
  return json(lessonDetailBody(data.lesson, data.slides))
}

/** Count question-type slides for a lesson. */
async function countQuestions(env: Env, lessonId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM lesson_slides WHERE lesson_id = ? AND type = 'question'`,
  )
    .bind(lessonId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * PATCH /api/courses/lessons/:id — save edits. Body may contain:
 *   - title?: string
 *   - estimatedDurationMinutes?: number | null
 *   - slides?: Array<{ id, content }>  → updates each slide's content blob.
 * Slides edits update content only (in place); structural changes (reorder /
 * delete) have their own routes. Bumps updated_at.
 */
async function saveLessonDetail(env: Env, id: string, request: Request): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const now = new Date().toISOString()
  const statements: D1PreparedStatement[] = []

  // Title + duration on the lessons row (only when provided).
  const sets: string[] = []
  const binds: unknown[] = []
  if (typeof body.title === 'string') {
    sets.push('title = ?')
    binds.push(body.title.slice(0, 300))
  }
  if ('estimatedDurationMinutes' in body) {
    const v = body.estimatedDurationMinutes
    const minutes =
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
    sets.push('estimated_duration_minutes = ?')
    binds.push(minutes)
  }
  sets.push('updated_at = ?')
  binds.push(now)
  binds.push(id)
  statements.push(
    env.DB.prepare(`UPDATE lessons SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
  )

  // Per-slide content updates (match by slide id, scoped to this lesson).
  if (Array.isArray(body.slides)) {
    const validIds = new Set(data.slides.map((s) => s.id))
    for (const raw of body.slides) {
      if (!raw || typeof raw !== 'object') continue
      const s = raw as Record<string, unknown>
      if (typeof s.id !== 'string' || !validIds.has(s.id)) continue
      if (!s.content || typeof s.content !== 'object') continue
      statements.push(
        env.DB.prepare(
          `UPDATE lesson_slides SET content = ? WHERE id = ? AND lesson_id = ?`,
        ).bind(JSON.stringify(s.content), s.id, id),
      )
    }
  }

  await env.DB.batch(statements)
  return getLessonDetail(env, id)
}

/**
 * POST /api/courses/lessons/:id/reorder — body: { order: string[] } where each
 * entry is a QUESTION slide id in the desired new sequence. The paired
 * explanation moves with its question; `order` is renumbered Q,E,Q,E,…
 * Returns the updated lesson detail.
 */
async function reorderLesson(env: Env, id: string, request: Request): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const requested = Array.isArray(body.order)
    ? body.order.filter((x): x is string => typeof x === 'string')
    : null
  if (!requested) return json({ error: 'Missing order[] of question slide ids' }, 400)

  // Build Q→E pairs by current order: each question is immediately followed by
  // its explanation. Pair them positionally.
  const pairs: { q: LessonSlideRow; e: LessonSlideRow | null }[] = []
  for (let i = 0; i < data.slides.length; i++) {
    const s = data.slides[i]
    if (s.type === 'question') {
      const next = data.slides[i + 1]
      pairs.push({ q: s, e: next && next.type === 'explanation' ? next : null })
    }
  }
  const byQId = new Map(pairs.map((p) => [p.q.id, p]))

  // The requested order must be a permutation of the existing question ids.
  if (
    requested.length !== pairs.length ||
    !requested.every((qid) => byQId.has(qid)) ||
    new Set(requested).size !== requested.length
  ) {
    return json({ error: 'order[] must be a permutation of the lesson question ids' }, 400)
  }

  const statements: D1PreparedStatement[] = []
  let order = 0
  for (const qid of requested) {
    const p = byQId.get(qid)!
    statements.push(
      env.DB.prepare(`UPDATE lesson_slides SET "order" = ? WHERE id = ?`).bind(order++, p.q.id),
    )
    if (p.e) {
      statements.push(
        env.DB.prepare(`UPDATE lesson_slides SET "order" = ? WHERE id = ?`).bind(order++, p.e.id),
      )
    }
  }
  statements.push(
    env.DB.prepare(`UPDATE lessons SET updated_at = ? WHERE id = ?`).bind(
      new Date().toISOString(),
      id,
    ),
  )
  await env.DB.batch(statements)
  return getLessonDetail(env, id)
}

/**
 * DELETE /api/courses/lessons/:id/questions/:order — delete the question at
 * `order` together with its paired explanation, then renumber. Enforces the
 * min-3-questions floor (server-side guard mirrors the client). 409 if at floor.
 */
async function deleteQuestionPair(env: Env, id: string, order: number): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)

  const qCount = data.slides.filter((s) => s.type === 'question').length
  if (qCount <= MIN_LESSON_QUESTIONS) {
    return json(
      {
        error: `A lesson must keep at least ${MIN_LESSON_QUESTIONS} questions. Delete is blocked.`,
      },
      409,
    )
  }

  const idx = data.slides.findIndex((s) => s.order === order && s.type === 'question')
  if (idx === -1) return json({ error: 'No question slide at that order' }, 404)

  const q = data.slides[idx]
  const next = data.slides[idx + 1]
  const removeIds = [q.id]
  if (next && next.type === 'explanation') removeIds.push(next.id)

  const statements: D1PreparedStatement[] = []
  for (const rid of removeIds) {
    statements.push(
      env.DB.prepare(`DELETE FROM lesson_slides WHERE id = ? AND lesson_id = ?`).bind(rid, id),
    )
  }
  // Renumber the survivors contiguously, preserving order.
  const survivors = data.slides.filter((s) => !removeIds.includes(s.id))
  let newOrder = 0
  for (const s of survivors) {
    statements.push(
      env.DB.prepare(`UPDATE lesson_slides SET "order" = ? WHERE id = ?`).bind(newOrder++, s.id),
    )
  }
  statements.push(
    env.DB.prepare(`UPDATE lessons SET updated_at = ? WHERE id = ?`).bind(
      new Date().toISOString(),
      id,
    ),
  )
  await env.DB.batch(statements)
  return getLessonDetail(env, id)
}

/** Build the convert deps from the request (presenter token + Workers AI). */
function convertDepsFromRequest(env: Env, request: Request, bodyToken: unknown) {
  const token = resolvePresenterToken(request.headers.get('authorization'), bodyToken)
  return {
    token,
    deps: {
      fetchSlides: fetchPresentationDetail,
      runAi: (prompt: string) => runWorkersAi(env.AI, prompt),
    },
  }
}

/**
 * POST /api/courses/lessons/:id/questions/:order/regenerate — regenerate ONE
 * grounded Q+E from the source presentation, replacing the pair at `order`.
 */
async function regenerateOne(env: Env, id: string, order: number, request: Request): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)
  if (data.lesson.source_presentation_id == null) {
    return json({ error: 'Lesson has no source presentation to regenerate from.' }, 422)
  }

  const idx = data.slides.findIndex((s) => s.order === order && s.type === 'question')
  if (idx === -1) return json({ error: 'No question slide at that order' }, 404)
  const qSlide = data.slides[idx]
  const eSlide = data.slides[idx + 1]?.type === 'explanation' ? data.slides[idx + 1] : null

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const { token, deps } = convertDepsFromRequest(env, request, body.token)
  try {
    const q = await regenerateOneQuestion(deps, String(data.lesson.source_presentation_id), token)
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`UPDATE lesson_slides SET content = ? WHERE id = ?`).bind(
        JSON.stringify({ question: q.question, options: q.options, correct_index: q.correct_index }),
        qSlide.id,
      ),
    ]
    if (eSlide) {
      statements.push(
        env.DB.prepare(`UPDATE lesson_slides SET content = ? WHERE id = ?`).bind(
          JSON.stringify({ explanation: q.explanation }),
          eSlide.id,
        ),
      )
    }
    statements.push(
      env.DB.prepare(`UPDATE lessons SET updated_at = ? WHERE id = ?`).bind(
        new Date().toISOString(),
        id,
      ),
    )
    await env.DB.batch(statements)
    return getLessonDetail(env, id)
  } catch (err) {
    if (err instanceof ConvertError) return json({ error: err.message }, err.status)
    return json({ error: 'Regeneration failed', detail: String((err as Error)?.message ?? err) }, 500)
  }
}

/**
 * POST /api/courses/lessons/:id/regenerate — regenerate the WHOLE lesson from
 * the source presentation, replacing all slides (warns the trainer client-side
 * that edits are lost). Returns the refreshed lesson detail.
 */
async function regenerateAll(env: Env, id: string, request: Request): Promise<Response> {
  const data = await loadLessonDetail(env, id)
  if (!data) return json({ error: 'Lesson not found' }, 404)
  if (data.lesson.source_presentation_id == null) {
    return json({ error: 'Lesson has no source presentation to regenerate from.' }, 422)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const { token, deps } = convertDepsFromRequest(env, request, body.token)
  try {
    await regenerateLessonAll(env.DB, deps, id, String(data.lesson.source_presentation_id), token)
    return getLessonDetail(env, id)
  } catch (err) {
    if (err instanceof ConvertError) return json({ error: err.message }, err.status)
    return json({ error: 'Regeneration failed', detail: String((err as Error)?.message ?? err) }, 500)
  }
}

/** POST /api/courses/lessons/:id/reviewed — mark the lesson as reviewed. */
async function markReviewed(env: Env, id: string): Promise<Response> {
  const res = await env.DB.prepare(
    `UPDATE lessons SET reviewed = 1, updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), id)
    .run()
  if (!res.meta || (res.meta.changes ?? 0) === 0) {
    return json({ error: 'Lesson not found' }, 404)
  }
  return getLessonDetail(env, id)
}

// ── Lesson publishing (WAT-12 / Stage 4) ─────────────────────────────────────
//
// The `lesson_slides` rows are the editable DRAFT. Publish/update-published
// SNAPSHOT the draft into lessons.published_slides_json + published_title; the
// public link serves ONLY that snapshot, so the live version keeps serving while
// the trainer edits. See migrations/0005_lesson_publishing.sql for the full
// versioning rationale (slug stable, draft-vs-live, learner progress preserved).
//
//   GET   /api/courses/lessons/:id/publish-state         → publishing fields
//   PUT   /api/courses/lessons/:id/auth-mode             → set auth_mode (pre-publish)
//   POST  /api/courses/lessons/:id/publish               → first publish (gated on reviewed)
//   POST  /api/courses/lessons/:id/update-published      → promote draft→live (keep slug)
//   POST  /api/courses/lessons/:id/unpublish             → take offline
//   GET   /api/learn/:slug                               → PUBLIC resolve slug→published

type AuthMode = 'anonymous' | 'name' | 'email'

const AUTH_MODES: AuthMode[] = ['anonymous', 'name', 'email']

function normalizeAuthMode(v: unknown): AuthMode | null {
  return typeof v === 'string' && (AUTH_MODES as string[]).includes(v) ? (v as AuthMode) : null
}

/** Full publishing-state row for a lesson (a superset of DetailLessonRow). */
interface PublishStateRow {
  id: string
  title: string
  status: string
  reviewed: number | null
  share_link_slug: string | null
  auth_mode: string | null
  published_title: string | null
  published_slides_json: string | null
  published_at: string | null
  updated_at: string
}

async function loadPublishState(env: Env, id: string): Promise<PublishStateRow | null> {
  return env.DB.prepare(
    `SELECT id, title, status, reviewed, share_link_slug, auth_mode,
            published_title, published_slides_json, published_at, updated_at
       FROM lessons WHERE id = ?`,
  )
    .bind(id)
    .first<PublishStateRow>()
}

/**
 * Serialize the publishing surface the lesson-detail UI needs. `hasDraftChanges`
 * is true when the lesson is published but the draft has been edited since the
 * last publish/promote (updated_at strictly after published_at) — i.e. there's
 * an unpublished draft to promote.
 */
function publishStateBody(row: PublishStateRow) {
  const status = row.status === 'published' ? 'published' : row.status === 'unpublished' ? 'unpublished' : 'draft'
  const hasDraftChanges =
    status === 'published' &&
    !!row.published_at &&
    new Date(row.updated_at).getTime() > new Date(row.published_at).getTime()
  return {
    id: row.id,
    status,
    reviewed: !!row.reviewed,
    authMode: normalizeAuthMode(row.auth_mode) ?? 'name',
    shareLinkSlug: row.share_link_slug,
    publishedAt: row.published_at,
    hasDraftChanges,
  }
}

/** GET /api/courses/lessons/:id/publish-state — publishing fields for the UI. */
async function getPublishState(env: Env, id: string): Promise<Response> {
  const row = await loadPublishState(env, id)
  if (!row) return json({ error: 'Lesson not found' }, 404)
  return json({ publishState: publishStateBody(row) })
}

/** PUT /api/courses/lessons/:id/auth-mode — set auth_mode (before publishing). */
async function setAuthMode(env: Env, id: string, request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const mode = normalizeAuthMode(body.authMode)
  if (!mode) {
    return json({ error: "authMode must be one of 'anonymous' | 'name' | 'email'" }, 400)
  }
  const res = await env.DB.prepare(
    `UPDATE lessons SET auth_mode = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(mode, new Date().toISOString(), id)
    .run()
  if (!res.meta || (res.meta.changes ?? 0) === 0) {
    return json({ error: 'Lesson not found' }, 404)
  }
  return getPublishState(env, id)
}

/** A short, URL-safe, lowercase slug (no ambiguous chars). */
function makeSlug(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

/** Build the published snapshot JSON from the current draft slides. */
async function snapshotDraftSlides(env: Env, lessonId: string): Promise<string> {
  const { results } = await env.DB.prepare(
    `SELECT "order", type, content FROM lesson_slides WHERE lesson_id = ? ORDER BY "order" ASC`,
  )
    .bind(lessonId)
    .all<{ order: number; type: string; content: string }>()
  const slides = (results ?? []).map((s) => ({
    order: s.order,
    type: s.type === 'question' ? 'question' : 'explanation',
    content: parseContent(s.content),
  }))
  return JSON.stringify(slides)
}

/**
 * POST /api/courses/lessons/:id/publish — first publish (or re-publish from
 * unpublished). Requires reviewed=true (409 otherwise). Generates a unique slug
 * ONLY on the first ever publish; reuses the existing slug afterwards. Snapshots
 * the current draft as the live published version and persists auth_mode if a
 * valid one is supplied in the body.
 */
async function publishLessonDetail(env: Env, id: string, request: Request): Promise<Response> {
  const row = await loadPublishState(env, id)
  if (!row) return json({ error: 'Lesson not found' }, 404)
  if (!row.reviewed) {
    return json(
      { error: 'This lesson must be reviewed before it can be published.' },
      409,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const requestedMode = normalizeAuthMode(body.authMode)
  const authMode = requestedMode ?? normalizeAuthMode(row.auth_mode) ?? 'name'

  // Slug: set once, then stable. Reuse on re-publish from unpublished.
  let slug = row.share_link_slug
  if (!slug) {
    // Generate a unique slug (retry on the rare collision).
    for (let i = 0; i < 5; i++) {
      const candidate = makeSlug()
      const clash = await env.DB.prepare(
        `SELECT id FROM lessons WHERE share_link_slug = ?`,
      )
        .bind(candidate)
        .first<{ id: string }>()
      if (!clash) {
        slug = candidate
        break
      }
    }
    if (!slug) return json({ error: 'Could not allocate a share link. Try again.' }, 500)
  }

  const snapshot = await snapshotDraftSlides(env, id)
  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE lessons
        SET status = 'published',
            share_link_slug = ?,
            auth_mode = ?,
            published_slides_json = ?,
            published_title = ?,
            published_at = ?,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(slug, authMode, snapshot, row.title, now, now, id)
    .run()

  return getPublishState(env, id)
}

/**
 * POST /api/courses/lessons/:id/update-published — promote the current draft to
 * the live published version. Re-snapshots the draft + title and re-syncs
 * published_at; the slug is untouched. 409 if the lesson was never published.
 * Learner progress is preserved (we only overwrite the snapshot columns).
 */
async function updatePublished(env: Env, id: string): Promise<Response> {
  const row = await loadPublishState(env, id)
  if (!row) return json({ error: 'Lesson not found' }, 404)
  if (!row.share_link_slug) {
    return json({ error: 'This lesson has not been published yet.' }, 409)
  }

  const snapshot = await snapshotDraftSlides(env, id)
  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE lessons
        SET status = 'published',
            published_slides_json = ?,
            published_title = ?,
            published_at = ?,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(snapshot, row.title, now, now, id)
    .run()

  return getPublishState(env, id)
}

/**
 * POST /api/courses/lessons/:id/unpublish — take the lesson offline. The slug +
 * snapshot are retained (so re-publishing reuses the same slug); the public link
 * shows a "not available" state. Learner progress is preserved.
 */
async function unpublishLesson(env: Env, id: string): Promise<Response> {
  const row = await loadPublishState(env, id)
  if (!row) return json({ error: 'Lesson not found' }, 404)
  await env.DB.prepare(
    `UPDATE lessons SET status = 'unpublished', updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), id)
    .run()
  return getPublishState(env, id)
}

/**
 * GET /api/learn/:slug — PUBLIC resolve a share-link slug to its LIVE published
 * lesson. No auth needed to fetch metadata (the learner player is Stage 5). For
 * an unknown slug OR a lesson that is not currently 'published' (draft/
 * unpublished), returns 404 { available: false } so the public page can show a
 * "this lesson is not available" state. The returned slides are the published
 * SNAPSHOT, never the live draft.
 */
async function getPublishedBySlug(env: Env, slug: string): Promise<Response> {
  if (!slug) return json({ available: false, error: 'Missing slug' }, 404)
  const row = await env.DB.prepare(
    `SELECT id, title, description, status, auth_mode, estimated_duration_minutes,
            published_title, published_slides_json
       FROM lessons WHERE share_link_slug = ?`,
  )
    .bind(slug)
    .first<{
      id: string
      title: string
      description: string | null
      status: string
      auth_mode: string | null
      estimated_duration_minutes: number | null
      published_title: string | null
      published_slides_json: string | null
    }>()

  if (!row || row.status !== 'published' || !row.published_slides_json) {
    return json({ available: false, error: 'This lesson is not available.' }, 404)
  }

  let slides: unknown[] = []
  try {
    const parsed = JSON.parse(row.published_slides_json)
    if (Array.isArray(parsed)) slides = parsed
  } catch {
    slides = []
  }

  return json({
    available: true,
    lesson: {
      id: row.id,
      title: row.published_title ?? row.title,
      description: typeof row.description === 'string' ? row.description : '',
      estimatedDurationMinutes:
        typeof row.estimated_duration_minutes === 'number'
          ? row.estimated_duration_minutes
          : null,
      authMode: normalizeAuthMode(row.auth_mode) ?? 'name',
      slides,
    },
  })
}

// ── WAT-13 (Stage 5): PUBLIC learner progress persistence ────────────────────
//
// Anonymous learners persist in the BROWSER (localStorage, keyed by slug) — they
// never touch these endpoints. Name/Email learners persist SERVER-SIDE here,
// keyed by the (lesson, identifier) pair. No AhaSlides account or token: the
// learner identifier is the only key. All three endpoints resolve the slug to
// the LIVE published lesson first; a slug that isn't currently published 404s
// (same not-available contract as GET /api/learn/:slug).
//
//   POST /api/learn/:slug/start     → create-or-resume a learner; returns
//                                      { learnerId, currentSlideOrder, completedAt }
//   POST /api/learn/:slug/progress  → upsert current_slide_order / completed_at
//   POST /api/learn/:slug/response  → record one answer (lesson_slide order + value)
//
// `learner_responses.lesson_slide_id` stores the slide ORDER (as text) within the
// published snapshot — the snapshot doesn't carry DB slide ids, and order is the
// stable per-lesson slide key the player already navigates by.

/** Resolve a slug to its LIVE published lesson id, or null if not available. */
async function resolvePublishedLessonId(env: Env, slug: string): Promise<string | null> {
  if (!slug) return null
  const row = await env.DB.prepare(
    `SELECT id, status, published_slides_json FROM lessons WHERE share_link_slug = ?`,
  )
    .bind(slug)
    .first<{ id: string; status: string; published_slides_json: string | null }>()
  if (!row || row.status !== 'published' || !row.published_slides_json) return null
  return row.id
}

/** Read + parse a JSON request body; returns {} on any failure. */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json()
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

interface ProgressRow {
  id: string
  current_slide_order: number
  completed_at: string | null
}

/** Load the (single) progress row for a learner on a lesson, or null. */
async function loadProgress(
  env: Env,
  learnerId: string,
  lessonId: string,
): Promise<ProgressRow | null> {
  return env.DB.prepare(
    `SELECT id, current_slide_order, completed_at
       FROM learner_progress WHERE learner_id = ? AND lesson_id = ?`,
  )
    .bind(learnerId, lessonId)
    .first<ProgressRow>()
}

/**
 * POST /api/learn/:slug/start — create-or-resume a server-side learner for a
 * name/email lesson. Body: { identifier: string }. Anonymous lessons don't use
 * this (the client persists locally), but if called we still create a learner
 * with a null identifier so the contract is uniform. Returns the learner id +
 * any existing progress so the client can resume from the last completed slide.
 */
async function startLearner(env: Env, slug: string, request: Request): Promise<Response> {
  const lessonId = await resolvePublishedLessonId(env, slug)
  if (!lessonId) return json({ error: 'This lesson is not available.' }, 404)

  const body = await readJsonBody(request)
  const rawId = typeof body.identifier === 'string' ? body.identifier.trim() : ''
  const identifier = rawId || null

  // Resume: an identified learner already on this lesson reuses their row.
  let learnerId: string | null = null
  if (identifier) {
    const existing = await env.DB.prepare(
      `SELECT id FROM learners WHERE lesson_id = ? AND identifier = ? LIMIT 1`,
    )
      .bind(lessonId, identifier)
      .first<{ id: string }>()
    if (existing) learnerId = existing.id
  }

  if (!learnerId) {
    learnerId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, lesson_id, identifier, created_at)
       VALUES (?, '', ?, ?, ?)`,
    )
      .bind(learnerId, lessonId, identifier, new Date().toISOString())
      .run()
  }

  const progress = await loadProgress(env, learnerId, lessonId)
  return json({
    learnerId,
    currentSlideOrder: progress?.current_slide_order ?? 0,
    completedAt: progress?.completed_at ?? null,
  })
}

/**
 * POST /api/learn/:slug/progress — upsert a learner's position.
 * Body: { learnerId: string, currentSlideOrder: number, completed?: boolean }.
 * Saved after every action so reopening resumes from the last completed slide.
 */
async function saveLearnerProgress(env: Env, slug: string, request: Request): Promise<Response> {
  const lessonId = await resolvePublishedLessonId(env, slug)
  if (!lessonId) return json({ error: 'This lesson is not available.' }, 404)

  const body = await readJsonBody(request)
  const learnerId = typeof body.learnerId === 'string' ? body.learnerId : ''
  if (!learnerId) return json({ error: 'learnerId required' }, 400)
  const currentSlideOrder =
    typeof body.currentSlideOrder === 'number' && Number.isFinite(body.currentSlideOrder)
      ? Math.max(0, Math.trunc(body.currentSlideOrder))
      : 0
  const completed = body.completed === true

  const existing = await loadProgress(env, learnerId, lessonId)
  const completedAt = completed ? new Date().toISOString() : null

  if (existing) {
    await env.DB.prepare(
      `UPDATE learner_progress
          SET current_slide_order = ?, completed_at = ?
        WHERE id = ?`,
    )
      .bind(currentSlideOrder, completedAt, existing.id)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO learner_progress
         (id, learner_id, lesson_id, current_slide_order, completed_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), learnerId, lessonId, currentSlideOrder, completedAt)
      .run()
  }

  return json({ ok: true, currentSlideOrder, completedAt })
}

/**
 * POST /api/learn/:slug/response — record one answer.
 * Body: { learnerId: string, slideOrder: number, value: unknown }.
 * `value` is stored as JSON text in learner_responses.response_value, keyed by
 * the slide order (as lesson_slide_id text).
 */
async function recordLearnerResponse(env: Env, slug: string, request: Request): Promise<Response> {
  const lessonId = await resolvePublishedLessonId(env, slug)
  if (!lessonId) return json({ error: 'This lesson is not available.' }, 404)

  const body = await readJsonBody(request)
  const learnerId = typeof body.learnerId === 'string' ? body.learnerId : ''
  if (!learnerId) return json({ error: 'learnerId required' }, 400)
  const slideOrder =
    typeof body.slideOrder === 'number' && Number.isFinite(body.slideOrder)
      ? Math.max(0, Math.trunc(body.slideOrder))
      : 0

  await env.DB.prepare(
    `INSERT INTO learner_responses
       (id, learner_id, lesson_slide_id, response_value, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      learnerId,
      String(slideOrder),
      JSON.stringify(body.value ?? null),
      new Date().toISOString(),
    )
    .run()

  return json({ ok: true })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      if (path === '/api/health') {
        return json({ ok: true, service: 'waterloo' })
      }

      // /api/lessons/convert (WAT-9) — match BEFORE the bare-id route so
      // "convert" isn't treated as a lesson id.
      if (path === '/api/lessons/convert') {
        if (request.method === 'POST') return convertLesson(env, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // ── /api/courses (WAT-10 live + WAT-8 stubs) ───────────────────────────
      // /api/courses/lessons — list normalized lessons (WAT-10, LIVE)
      // Match BEFORE /api/courses/:id so "lessons" isn't treated as a course id.
      if (path === '/api/courses/lessons') {
        if (request.method === 'GET') return listNormalizedLessons(env)
        return json({ error: 'Method not allowed' }, 405)
      }

      // ── WAT-11 lesson detail / editor routes ───────────────────────────────
      // Match the deepest paths first so :id isn't shadowed.

      // /api/courses/lessons/:id/questions/:order/regenerate
      const regenOneMatch = path.match(
        /^\/api\/courses\/lessons\/([^/]+)\/questions\/(\d+)\/regenerate$/,
      )
      if (regenOneMatch) {
        const lid = decodeURIComponent(regenOneMatch[1])
        const order = Number(regenOneMatch[2])
        if (request.method === 'POST') return regenerateOne(env, lid, order, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/questions/:order  (delete a Q+E pair)
      const delQMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/questions\/(\d+)$/)
      if (delQMatch) {
        const lid = decodeURIComponent(delQMatch[1])
        const order = Number(delQMatch[2])
        if (request.method === 'DELETE') return deleteQuestionPair(env, lid, order)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/reorder
      const reorderMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/reorder$/)
      if (reorderMatch) {
        const lid = decodeURIComponent(reorderMatch[1])
        if (request.method === 'POST') return reorderLesson(env, lid, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/regenerate  (whole lesson)
      const regenAllMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/regenerate$/)
      if (regenAllMatch) {
        const lid = decodeURIComponent(regenAllMatch[1])
        if (request.method === 'POST') return regenerateAll(env, lid, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/reviewed
      const reviewedMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/reviewed$/)
      if (reviewedMatch) {
        const lid = decodeURIComponent(reviewedMatch[1])
        if (request.method === 'POST') return markReviewed(env, lid)
        return json({ error: 'Method not allowed' }, 405)
      }

      // ── WAT-12 publishing routes ───────────────────────────────────────────
      // /api/courses/lessons/:id/publish-state
      const pubStateMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/publish-state$/)
      if (pubStateMatch) {
        const lid = decodeURIComponent(pubStateMatch[1])
        if (request.method === 'GET') return getPublishState(env, lid)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/auth-mode
      const authModeMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/auth-mode$/)
      if (authModeMatch) {
        const lid = decodeURIComponent(authModeMatch[1])
        if (request.method === 'PUT') return setAuthMode(env, lid, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/publish
      const pubMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/publish$/)
      if (pubMatch) {
        const lid = decodeURIComponent(pubMatch[1])
        if (request.method === 'POST') return publishLessonDetail(env, lid, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/update-published
      const updPubMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/update-published$/)
      if (updPubMatch) {
        const lid = decodeURIComponent(updPubMatch[1])
        if (request.method === 'POST') return updatePublished(env, lid)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id/unpublish
      const unpubMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)\/unpublish$/)
      if (unpubMatch) {
        const lid = decodeURIComponent(unpubMatch[1])
        if (request.method === 'POST') return unpublishLesson(env, lid)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses/lessons/:id  (get detail / save edits)
      const lessonDetailMatch = path.match(/^\/api\/courses\/lessons\/([^/]+)$/)
      if (lessonDetailMatch) {
        const lid = decodeURIComponent(lessonDetailMatch[1])
        if (request.method === 'GET') return getLessonDetail(env, lid)
        if (request.method === 'PATCH') return saveLessonDetail(env, lid, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/courses  (collection: list / create — WAT-8 stub)
      if (path === '/api/courses') {
        if (request.method === 'GET') return coursesStub('GET /api/courses')
        if (request.method === 'POST') return coursesStub('POST /api/courses')
        return json({ error: 'Method not allowed' }, 405)
      }
      // /api/courses/:id  (item: get / update / delete — WAT-8 stub)
      const courseMatch = path.match(/^\/api\/courses\/([^/]+)$/)
      if (courseMatch) {
        if (['GET', 'PUT', 'DELETE'].includes(request.method)) {
          return coursesStub(`${request.method} /api/courses/:id`)
        }
        return json({ error: 'Method not allowed' }, 405)
      }
      // /api/courses/:id/lessons  (course ↔ lesson membership)
      const courseLessonsMatch = path.match(/^\/api\/courses\/([^/]+)\/lessons$/)
      if (courseLessonsMatch) {
        if (['GET', 'POST'].includes(request.method)) {
          return coursesStub(`${request.method} /api/courses/:id/lessons`)
        }
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/lessons/:lessonId/attempts  (match BEFORE the bare-id route)
      const attemptsMatch = path.match(/^\/api\/lessons\/([^/]+)\/attempts$/)
      if (attemptsMatch) {
        const lessonId = decodeURIComponent(attemptsMatch[1])
        if (request.method === 'POST') {
          return createAttempt(env, lessonId, request)
        }
        if (request.method === 'GET') {
          return listAttempts(env, lessonId)
        }
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/lessons/:id/publish
      const publishMatch = path.match(/^\/api\/lessons\/([^/]+)\/publish$/)
      if (publishMatch) {
        const id = decodeURIComponent(publishMatch[1])
        if (request.method === 'POST') return publishLesson(env, id)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/lessons  (list)
      if (path === '/api/lessons') {
        if (request.method === 'GET') return listLessons(env)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/lessons/:id  (get / upsert / delete)
      const lessonMatch = path.match(/^\/api\/lessons\/([^/]+)$/)
      if (lessonMatch) {
        const id = decodeURIComponent(lessonMatch[1])
        if (request.method === 'GET') return getLesson(env, id)
        if (request.method === 'PUT') return upsertLesson(env, id, request)
        if (request.method === 'DELETE') return deleteLesson(env, id)
        return json({ error: 'Method not allowed' }, 405)
      }

      // WAT-13 learner persistence — match the deeper paths BEFORE the bare slug.
      // /api/learn/:slug/start  (PUBLIC — create-or-resume a server-side learner)
      const learnStartMatch = path.match(/^\/api\/learn\/([^/]+)\/start$/)
      if (learnStartMatch) {
        const slug = decodeURIComponent(learnStartMatch[1])
        if (request.method === 'POST') return startLearner(env, slug, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/learn/:slug/progress  (PUBLIC — upsert current slide / completion)
      const learnProgressMatch = path.match(/^\/api\/learn\/([^/]+)\/progress$/)
      if (learnProgressMatch) {
        const slug = decodeURIComponent(learnProgressMatch[1])
        if (request.method === 'POST') return saveLearnerProgress(env, slug, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/learn/:slug/response  (PUBLIC — record one answer)
      const learnResponseMatch = path.match(/^\/api\/learn\/([^/]+)\/response$/)
      if (learnResponseMatch) {
        const slug = decodeURIComponent(learnResponseMatch[1])
        if (request.method === 'POST') return recordLearnerResponse(env, slug, request)
        return json({ error: 'Method not allowed' }, 405)
      }

      // /api/learn/:slug  (PUBLIC — resolve a share-link slug to its published lesson)
      const learnMatch = path.match(/^\/api\/learn\/([^/]+)$/)
      if (learnMatch) {
        const slug = decodeURIComponent(learnMatch[1])
        if (request.method === 'GET') return getPublishedBySlug(env, slug)
        return json({ error: 'Method not allowed' }, 405)
      }

      return json({ error: 'Not found' }, 404)
    }

    // Fallback to the static asset handler.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
