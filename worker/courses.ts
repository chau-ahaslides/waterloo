/**
 * WAT-14 (Stage 6) — Course container backend.
 *
 * A Course groups multiple published Lessons behind ONE public share link
 * (`ahaslides.com/learn/c/[slug]`). Individual lessons stay independently
 * shareable (Stage 4). A lesson belongs to AT MOST ONE course at a time (the
 * "one-course-per-lesson" rule, enforced on add).
 *
 * Models (migrations 0003 + 0007):
 *   - courses           — title/description/owner_id/share_link_slug/auth_mode/
 *                         order_mode/status + publish snapshot columns (0007).
 *   - course_lessons    — ordered membership (course_id, lesson_id, order).
 *   - learners          — a person taking a course (course_id set, lesson_id NULL).
 *   - learner_progress  — per-(learner, lesson) completion; course_id scoped (0007).
 *
 * Trainer routes (same-origin, JSON):
 *   GET    /api/courses                       → list courses (newest first)
 *   POST   /api/courses                       → create a DRAFT course (+ members)
 *   GET    /api/courses/:id                   → course + ordered member lessons
 *   PATCH  /api/courses/:id                   → edit title/description/order_mode/auth_mode
 *   DELETE /api/courses/:id                   → delete a course (+ membership)
 *   POST   /api/courses/:id/lessons           → add a lesson (one-course-per-lesson)
 *   DELETE /api/courses/:id/lessons/:lessonId → remove a lesson
 *   POST   /api/courses/:id/reorder           → reorder members by lesson-id list
 *   POST   /api/courses/:id/publish           → publish; mint stable slug + snapshot
 *   POST   /api/courses/:id/unpublish         → take offline (slug retained)
 *
 * Public learner routes:
 *   GET    /api/learn/c/:slug                 → resolve slug → course + lessons + authMode
 *   POST   /api/learn/c/:slug/start           → create-or-resume a course learner
 *   POST   /api/learn/c/:slug/progress        → mark one member lesson complete
 */

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

type AuthMode = 'anonymous' | 'name' | 'email'
type OrderMode = 'free' | 'sequential'

const AUTH_MODES: AuthMode[] = ['anonymous', 'name', 'email']
const ORDER_MODES: OrderMode[] = ['free', 'sequential']

function normalizeAuthMode(v: unknown, fallback: AuthMode = 'name'): AuthMode {
  return typeof v === 'string' && (AUTH_MODES as string[]).includes(v) ? (v as AuthMode) : fallback
}
function normalizeOrderMode(v: unknown, fallback: OrderMode = 'free'): OrderMode {
  return typeof v === 'string' && (ORDER_MODES as string[]).includes(v) ? (v as OrderMode) : fallback
}

/** A short, URL-safe, lowercase slug (no ambiguous chars). Mirrors the lesson one. */
function makeSlug(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json()
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ── DB row shapes ────────────────────────────────────────────────────────────

interface CourseRow {
  id: string
  title: string
  description: string
  owner_id: string | null
  share_link_slug: string | null
  auth_mode: string
  order_mode: string
  status: string
  published_lessons_json: string | null
  published_title: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** A member lesson joined with its publish/duration info for the detail view. */
interface MemberLessonRow {
  course_lesson_id: string
  order: number
  lesson_id: string
  title: string
  status: string
  share_link_slug: string | null
  estimated_duration_minutes: number | null
  slide_count: number
}

function courseStatus(s: string): 'draft' | 'published' | 'unpublished' {
  return s === 'published' ? 'published' : s === 'unpublished' ? 'unpublished' : 'draft'
}

async function loadCourse(env: Env, id: string): Promise<CourseRow | null> {
  return env.DB.prepare(
    `SELECT id, title, description, owner_id, share_link_slug, auth_mode, order_mode,
            status, published_lessons_json, published_title, published_at,
            created_at, updated_at
       FROM courses WHERE id = ?`,
  )
    .bind(id)
    .first<CourseRow>()
}

/** Ordered member lessons of a course, with per-lesson duration + slide count. */
async function loadMembers(env: Env, courseId: string): Promise<MemberLessonRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT cl.id        AS course_lesson_id,
            cl."order"   AS "order",
            l.id         AS lesson_id,
            l.title      AS title,
            l.status     AS status,
            l.share_link_slug AS share_link_slug,
            l.estimated_duration_minutes AS estimated_duration_minutes,
            COUNT(ls.id) AS slide_count
       FROM course_lessons cl
       JOIN lessons l ON l.id = cl.lesson_id
       LEFT JOIN lesson_slides ls ON ls.lesson_id = l.id
      WHERE cl.course_id = ?
      GROUP BY cl.id
      ORDER BY cl."order" ASC`,
  )
    .bind(courseId)
    .all<MemberLessonRow>()
  return results ?? []
}

function memberBody(m: MemberLessonRow) {
  return {
    courseLessonId: m.course_lesson_id,
    order: m.order,
    lessonId: m.lesson_id,
    title: m.title,
    status: m.status === 'published' ? 'published' : m.status === 'unpublished' ? 'unpublished' : 'draft',
    shareLinkSlug: m.share_link_slug,
    estimatedDurationMinutes: m.estimated_duration_minutes,
    slideCount: m.slide_count,
  }
}

/** Serialize a course + its ordered members into the trainer API shape. */
function courseDetailBody(course: CourseRow, members: MemberLessonRow[]) {
  const totalDuration = members.reduce(
    (sum, m) => sum + (typeof m.estimated_duration_minutes === 'number' ? m.estimated_duration_minutes : 0),
    0,
  )
  return {
    course: {
      id: course.id,
      title: course.title,
      description: course.description,
      authMode: normalizeAuthMode(course.auth_mode),
      orderMode: normalizeOrderMode(course.order_mode),
      status: courseStatus(course.status),
      shareLinkSlug: course.share_link_slug,
      publishedAt: course.published_at,
      lessonCount: members.length,
      totalDurationMinutes: totalDuration,
      createdAt: course.created_at,
      updatedAt: course.updated_at,
    },
    lessons: members.map(memberBody),
  }
}

// ── List / create ────────────────────────────────────────────────────────────

interface CourseListRow extends CourseRow {
  lesson_count: number
  total_duration: number | null
}

/** GET /api/courses — all courses, newest first, with lesson count + duration. */
export async function listCourses(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.title, c.description, c.owner_id, c.share_link_slug, c.auth_mode,
            c.order_mode, c.status, c.published_lessons_json, c.published_title,
            c.published_at, c.created_at, c.updated_at,
            COUNT(cl.id) AS lesson_count,
            SUM(l.estimated_duration_minutes) AS total_duration
       FROM courses c
       LEFT JOIN course_lessons cl ON cl.course_id = c.id
       LEFT JOIN lessons l ON l.id = cl.lesson_id
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
  ).all<CourseListRow>()

  const courses = (results ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    authMode: normalizeAuthMode(c.auth_mode),
    orderMode: normalizeOrderMode(c.order_mode),
    status: courseStatus(c.status),
    shareLinkSlug: c.share_link_slug,
    lessonCount: c.lesson_count ?? 0,
    totalDurationMinutes: c.total_duration ?? 0,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }))
  return json({ courses })
}

/**
 * POST /api/courses — create a DRAFT course. Body:
 *   { title, description?, orderMode?, authMode?, lessonIds?: string[] }
 * Member lessons are added in the given order, skipping any that already belong
 * to another course (one-course-per-lesson). Returns the created course detail.
 */
export async function createCourse(env: Env, request: Request): Promise<Response> {
  const body = await readJsonBody(request)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return json({ error: 'A course title is required.' }, 400)
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const orderMode = normalizeOrderMode(body.orderMode, 'free')
  const authMode = normalizeAuthMode(body.authMode, 'name')
  const lessonIds = Array.isArray(body.lessonIds)
    ? body.lessonIds.filter((x): x is string => typeof x === 'string')
    : []

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO courses
       (id, title, description, owner_id, share_link_slug, auth_mode, order_mode,
        status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, 'draft', ?, ?)`,
  )
    .bind(id, title, description, authMode, orderMode, now, now)
    .run()

  // Add members in order, skipping lessons already owned by another course.
  let order = 0
  for (const lessonId of lessonIds) {
    const taken = await env.DB.prepare(
      `SELECT course_id FROM course_lessons WHERE lesson_id = ? LIMIT 1`,
    )
      .bind(lessonId)
      .first<{ course_id: string }>()
    if (taken) continue // one-course-per-lesson
    const lessonExists = await env.DB.prepare(`SELECT id FROM lessons WHERE id = ?`)
      .bind(lessonId)
      .first<{ id: string }>()
    if (!lessonExists) continue
    await env.DB.prepare(
      `INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES (?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), id, lessonId, order)
      .run()
    order++
  }

  const course = await loadCourse(env, id)
  const members = await loadMembers(env, id)
  return json(courseDetailBody(course as CourseRow, members), 201)
}

// ── Detail / edit / delete ─────────────────────────────────────────────────────

/** GET /api/courses/:id — course + ordered member lessons (with total duration). */
export async function getCourse(env: Env, id: string): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  const members = await loadMembers(env, id)
  return json(courseDetailBody(course, members))
}

/**
 * PATCH /api/courses/:id — edit title/description/orderMode/authMode (any subset).
 * Bumps updated_at. Returns the updated detail.
 */
export async function patchCourse(env: Env, id: string, request: Request): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)

  const body = await readJsonBody(request)
  const sets: string[] = []
  const binds: unknown[] = []

  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (!t) return json({ error: 'Title cannot be empty.' }, 400)
    sets.push('title = ?')
    binds.push(t)
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?')
    binds.push(body.description.trim())
  }
  if (body.orderMode !== undefined) {
    sets.push('order_mode = ?')
    binds.push(normalizeOrderMode(body.orderMode, normalizeOrderMode(course.order_mode)))
  }
  if (body.authMode !== undefined) {
    sets.push('auth_mode = ?')
    binds.push(normalizeAuthMode(body.authMode, normalizeAuthMode(course.auth_mode)))
  }

  if (sets.length) {
    sets.push('updated_at = ?')
    binds.push(new Date().toISOString())
    binds.push(id)
    await env.DB.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run()
  }
  return getCourse(env, id)
}

/** DELETE /api/courses/:id — delete a course and its membership rows. */
export async function deleteCourse(env: Env, id: string): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM course_lessons WHERE course_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM courses WHERE id = ?`).bind(id),
  ])
  return json({ ok: true })
}

// ── Membership: add / remove / reorder ─────────────────────────────────────────

/**
 * POST /api/courses/:id/lessons — add a lesson to the course at the end.
 * Body: { lessonId }. Enforces one-course-per-lesson (409 if already owned by a
 * DIFFERENT course; no-op-success if already in THIS course).
 */
export async function addCourseLesson(env: Env, id: string, request: Request): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  const body = await readJsonBody(request)
  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : ''
  if (!lessonId) return json({ error: 'lessonId required' }, 400)

  const lessonExists = await env.DB.prepare(`SELECT id FROM lessons WHERE id = ?`)
    .bind(lessonId)
    .first<{ id: string }>()
  if (!lessonExists) return json({ error: 'Lesson not found' }, 404)

  const taken = await env.DB.prepare(
    `SELECT course_id FROM course_lessons WHERE lesson_id = ? LIMIT 1`,
  )
    .bind(lessonId)
    .first<{ course_id: string }>()
  if (taken) {
    if (taken.course_id === id) return getCourse(env, id) // already a member — idempotent
    return json({ error: 'This lesson already belongs to another course.' }, 409)
  }

  const maxRow = await env.DB.prepare(
    `SELECT MAX("order") AS max_order FROM course_lessons WHERE course_id = ?`,
  )
    .bind(id)
    .first<{ max_order: number | null }>()
  const nextOrder = (maxRow?.max_order ?? -1) + 1
  await env.DB.prepare(
    `INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES (?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), id, lessonId, nextOrder)
    .run()
  await env.DB.prepare(`UPDATE courses SET updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), id)
    .run()
  return getCourse(env, id)
}

/** DELETE /api/courses/:id/lessons/:lessonId — remove a lesson from the course. */
export async function removeCourseLesson(
  env: Env,
  id: string,
  lessonId: string,
): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  await env.DB.prepare(`DELETE FROM course_lessons WHERE course_id = ? AND lesson_id = ?`)
    .bind(id, lessonId)
    .run()
  await env.DB.prepare(`UPDATE courses SET updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), id)
    .run()
  return getCourse(env, id)
}

/**
 * POST /api/courses/:id/reorder — body: { order: string[] } where each entry is a
 * member lesson id in the new sequence. Re-numbers "order" 0..n-1 for the listed
 * lessons; any unlisted member keeps its relative position after the listed ones.
 */
export async function reorderCourse(env: Env, id: string, request: Request): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  const body = await readJsonBody(request)
  const order = Array.isArray(body.order)
    ? body.order.filter((x): x is string => typeof x === 'string')
    : []

  const members = await loadMembers(env, id)
  const memberIds = new Set(members.map((m) => m.lesson_id))
  // New sequence: the requested order (filtered to actual members) then any
  // members not mentioned, in their current order.
  const seen = new Set<string>()
  const sequence: string[] = []
  for (const lid of order) {
    if (memberIds.has(lid) && !seen.has(lid)) {
      sequence.push(lid)
      seen.add(lid)
    }
  }
  for (const m of members) {
    if (!seen.has(m.lesson_id)) sequence.push(m.lesson_id)
  }

  const now = new Date().toISOString()
  const stmts = sequence.map((lid, idx) =>
    env.DB.prepare(`UPDATE course_lessons SET "order" = ? WHERE course_id = ? AND lesson_id = ?`)
      .bind(idx, id, lid),
  )
  stmts.push(env.DB.prepare(`UPDATE courses SET updated_at = ? WHERE id = ?`).bind(now, id))
  if (stmts.length) await env.DB.batch(stmts)
  return getCourse(env, id)
}

// ── Publish / unpublish ────────────────────────────────────────────────────────

/** A snapshot entry for one member lesson at course-publish time. */
interface CoursePublishedLesson {
  lessonId: string
  slug: string
  title: string
  order: number
  estimatedDurationMinutes: number | null
}

/**
 * POST /api/courses/:id/publish — mint a stable slug (once) and snapshot the
 * current ORDERED membership. Only member lessons that are themselves published
 * (have a live slug) are included in the snapshot. Requires >=1 publishable
 * member lesson (409 otherwise). Reuses the slug on re-publish.
 */
export async function publishCourse(env: Env, id: string): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)

  const members = await loadMembers(env, id)
  const publishable: CoursePublishedLesson[] = members
    .filter((m) => m.status === 'published' && !!m.share_link_slug)
    .map((m, idx) => ({
      lessonId: m.lesson_id,
      slug: m.share_link_slug as string,
      title: m.title,
      order: idx,
      estimatedDurationMinutes: m.estimated_duration_minutes,
    }))

  if (publishable.length === 0) {
    return json(
      { error: 'Add at least one PUBLISHED lesson before publishing the course.' },
      409,
    )
  }

  let slug = course.share_link_slug
  if (!slug) {
    for (let i = 0; i < 5; i++) {
      const candidate = makeSlug()
      const clash = await env.DB.prepare(`SELECT id FROM courses WHERE share_link_slug = ?`)
        .bind(candidate)
        .first<{ id: string }>()
      if (!clash) {
        slug = candidate
        break
      }
    }
    if (!slug) return json({ error: 'Could not allocate a share link. Try again.' }, 500)
  }

  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE courses
        SET status = 'published',
            share_link_slug = ?,
            published_lessons_json = ?,
            published_title = ?,
            published_at = ?,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(slug, JSON.stringify(publishable), course.title, now, now, id)
    .run()

  return getCourse(env, id)
}

/** POST /api/courses/:id/unpublish — take offline; slug + snapshot retained. */
export async function unpublishCourse(env: Env, id: string): Promise<Response> {
  const course = await loadCourse(env, id)
  if (!course) return json({ error: 'Course not found' }, 404)
  await env.DB.prepare(`UPDATE courses SET status = 'unpublished', updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), id)
    .run()
  return getCourse(env, id)
}

// ── PUBLIC learner-facing course resolve + progress ─────────────────────────────

/** Resolve a course slug → its row if currently published, else null. */
async function resolvePublishedCourse(env: Env, slug: string): Promise<CourseRow | null> {
  if (!slug) return null
  const row = await env.DB.prepare(
    `SELECT id, title, description, owner_id, share_link_slug, auth_mode, order_mode,
            status, published_lessons_json, published_title, published_at,
            created_at, updated_at
       FROM courses WHERE share_link_slug = ?`,
  )
    .bind(slug)
    .first<CourseRow>()
  if (!row || row.status !== 'published' || !row.published_lessons_json) return null
  return row
}

function parsePublishedLessons(raw: string | null): CoursePublishedLesson[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x, idx) => ({
        lessonId: typeof x.lessonId === 'string' ? x.lessonId : '',
        slug: typeof x.slug === 'string' ? x.slug : '',
        title: typeof x.title === 'string' ? x.title : '',
        order: typeof x.order === 'number' ? x.order : idx,
        estimatedDurationMinutes:
          typeof x.estimatedDurationMinutes === 'number' ? x.estimatedDurationMinutes : null,
      }))
      .filter((x) => x.lessonId && x.slug)
      .sort((a, b) => a.order - b.order)
  } catch {
    return []
  }
}

/**
 * GET /api/learn/c/:slug — PUBLIC course landing data. Returns the course meta +
 * ordered lessons (each with its own public slug + duration) + authMode + order
 * mode. Optional ?learnerId= returns that learner's completed lesson ids so the
 * landing can render completion + sequential locking on first paint.
 */
export async function getCourseBySlug(env: Env, slug: string, url: URL): Promise<Response> {
  const course = await resolvePublishedCourse(env, slug)
  if (!course) return json({ available: false, error: 'This course is not available.' }, 404)

  const lessons = parsePublishedLessons(course.published_lessons_json)
  const totalDuration = lessons.reduce(
    (sum, l) => sum + (l.estimatedDurationMinutes ?? 0),
    0,
  )

  let completedLessonIds: string[] = []
  const learnerId = url.searchParams.get('learnerId')
  if (learnerId) {
    completedLessonIds = await loadCompletedLessonIds(env, learnerId, course.id)
  }

  return json({
    available: true,
    course: {
      id: course.id,
      title: course.published_title ?? course.title,
      description: course.description,
      authMode: normalizeAuthMode(course.auth_mode),
      orderMode: normalizeOrderMode(course.order_mode),
      totalDurationMinutes: totalDuration,
      lessons: lessons.map((l) => ({
        lessonId: l.lessonId,
        slug: l.slug,
        title: l.title,
        order: l.order,
        estimatedDurationMinutes: l.estimatedDurationMinutes,
      })),
    },
    completedLessonIds,
  })
}

/** Completed member-lesson ids for a course learner. */
async function loadCompletedLessonIds(
  env: Env,
  learnerId: string,
  courseId: string,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT lesson_id FROM learner_progress
      WHERE learner_id = ? AND course_id = ? AND completed_at IS NOT NULL`,
  )
    .bind(learnerId, courseId)
    .all<{ lesson_id: string }>()
  return (results ?? []).map((r) => r.lesson_id)
}

/**
 * POST /api/learn/c/:slug/start — create-or-resume a COURSE learner.
 * Body: { identifier?: string }. For anonymous courses the client persists
 * locally and never calls this; for name/email courses we create/resume a
 * course-scoped learner (course_id set, lesson_id NULL) and return their
 * completed lesson ids so the landing reflects progress.
 */
export async function startCourseLearner(env: Env, slug: string, request: Request): Promise<Response> {
  const course = await resolvePublishedCourse(env, slug)
  if (!course) return json({ error: 'This course is not available.' }, 404)

  const body = await readJsonBody(request)
  const rawId = typeof body.identifier === 'string' ? body.identifier.trim() : ''
  const identifier = rawId || null

  let learnerId: string | null = null
  if (identifier) {
    const existing = await env.DB.prepare(
      `SELECT id FROM learners WHERE course_id = ? AND identifier = ? AND lesson_id IS NULL LIMIT 1`,
    )
      .bind(course.id, identifier)
      .first<{ id: string }>()
    if (existing) learnerId = existing.id
  }
  if (!learnerId) {
    learnerId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, lesson_id, identifier, created_at)
       VALUES (?, ?, NULL, ?, ?)`,
    )
      .bind(learnerId, course.id, identifier, new Date().toISOString())
      .run()
  }

  const completedLessonIds = await loadCompletedLessonIds(env, learnerId, course.id)
  return json({ learnerId, completedLessonIds })
}

/**
 * POST /api/learn/c/:slug/progress — mark ONE member lesson complete (or update
 * its position) for a course learner. Body:
 *   { learnerId, lessonId, completed?: boolean, currentSlideOrder?: number }.
 * Course completion is derived (all member lessons complete) and returned.
 */
export async function saveCourseProgress(env: Env, slug: string, request: Request): Promise<Response> {
  const course = await resolvePublishedCourse(env, slug)
  if (!course) return json({ error: 'This course is not available.' }, 404)

  const body = await readJsonBody(request)
  const learnerId = typeof body.learnerId === 'string' ? body.learnerId : ''
  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : ''
  if (!learnerId || !lessonId) return json({ error: 'learnerId and lessonId required' }, 400)
  const completed = body.completed === true
  const currentSlideOrder =
    typeof body.currentSlideOrder === 'number' && Number.isFinite(body.currentSlideOrder)
      ? Math.max(0, Math.trunc(body.currentSlideOrder))
      : 0

  const existing = await env.DB.prepare(
    `SELECT id, completed_at FROM learner_progress
      WHERE learner_id = ? AND lesson_id = ? AND course_id = ?`,
  )
    .bind(learnerId, lessonId, course.id)
    .first<{ id: string; completed_at: string | null }>()

  const now = new Date().toISOString()
  // Once complete, stay complete (don't clear on a later position-only save).
  const completedAt = completed ? now : existing?.completed_at ?? null

  if (existing) {
    await env.DB.prepare(
      `UPDATE learner_progress SET current_slide_order = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(currentSlideOrder, completedAt, existing.id)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO learner_progress
         (id, learner_id, lesson_id, course_id, current_slide_order, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), learnerId, lessonId, course.id, currentSlideOrder, completedAt)
      .run()
  }

  const lessons = parsePublishedLessons(course.published_lessons_json)
  const completedLessonIds = await loadCompletedLessonIds(env, learnerId, course.id)
  const courseComplete =
    lessons.length > 0 && lessons.every((l) => completedLessonIds.includes(l.lessonId))

  return json({ ok: true, completedLessonIds, courseComplete })
}
