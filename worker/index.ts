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
 *   - GET  /api/health
 *   - POST /api/lessons/:lessonId/attempts   → insert ONE attempt; returns it.
 *   - GET  /api/lessons/:lessonId/attempts   → all attempts for a lesson,
 *                                              newest first (for the report).
 *
 * Attempts are persisted in D1 (`env.DB`). Multiple attempts per lesson are
 * allowed — every POST is a new row (no upsert/dedupe). Each row carries a
 * self-contained per-slide `responses` snapshot so the report renders from D1
 * alone (the lesson definition itself lives only in the creator's localStorage).
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

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      if (path === '/api/health') {
        return json({ ok: true, service: 'waterloo' })
      }

      // /api/lessons/:lessonId/attempts
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

      return json({ error: 'Not found' }, 404)
    }

    // Fallback to the static asset handler.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
