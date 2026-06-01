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

// ── Courses (WAT-8) — STUB routes ────────────────────────────────────────────
//
// Foundation stage: the Courses-feature data models exist in D1
// (migrations/0003_courses_foundation.sql) but no business logic is wired yet.
// These handlers are intentional placeholders so the route surface exists for
// later stages (WAT-9..15) to fill in. They return 501 Not Implemented with a
// TODO marker rather than touching the DB.
//
// NOTE: this does NOT alter the existing /api/lessons routes (live editor /
// converter / Take / Report from WAT-1/WAT-3/WAT-5). It only adds the new
// /api/courses surface.

/** A consistent 501 stub response for not-yet-implemented Courses endpoints. */
function coursesStub(route: string): Response {
  return json(
    { error: 'Not Implemented', todo: `WAT-8 stub — ${route} not implemented yet` },
    501,
  )
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      if (path === '/api/health') {
        return json({ ok: true, service: 'waterloo' })
      }

      // ── /api/courses (WAT-8 STUBS — no logic yet) ──────────────────────────
      // /api/courses  (collection: list / create)
      if (path === '/api/courses') {
        if (request.method === 'GET') return coursesStub('GET /api/courses')
        if (request.method === 'POST') return coursesStub('POST /api/courses')
        return json({ error: 'Method not allowed' }, 405)
      }
      // /api/courses/:id  (item: get / update / delete)
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

      return json({ error: 'Not found' }, 404)
    }

    // Fallback to the static asset handler.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
