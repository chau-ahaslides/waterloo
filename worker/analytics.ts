/**
 * WAT-15 (Stage 7) — OWNER-FACING progress dashboards for the Courses program.
 *
 * Analytics over the Courses learner tables (WAT-8): `learners`,
 * `learner_progress` (completed_at, current_slide_order) and `learner_responses`
 * (lesson_slide_id = the slide ORDER as text, response_value = the player's
 * answer JSON `{ selected, correct }`). These are the SELF-PACED course learner
 * tables — a DIFFERENT data model from the legacy `attempts` table that powers
 * the original audience Report (WAT-5, `/lesson/:id/report`). This module never
 * touches `attempts`; the two analytics surfaces are deliberately separate.
 *
 * Endpoints (trainer-only; the learner /learn routes never expose these):
 *   GET /api/courses/lessons/:id/analytics   → lesson dashboard data
 *   GET /api/courses/:id/analytics           → course dashboard data
 *
 * ── Data-model facts the math relies on ──────────────────────────────────────
 *   - A lesson learner row has `lesson_id` set (course_id = '' sentinel). A
 *     course learner row has `course_id` set + lesson_id NULL. When a course is
 *     taken, the per-lesson player (/learn/:slug) creates LESSON-scoped learner
 *     rows, so lesson analytics count by `learners.lesson_id` uniformly.
 *   - ANONYMOUS lessons/courses: the player persists locally and NEVER calls the
 *     server, so there are typically no learner rows at all. We still return
 *     AGGREGATE-ONLY data (counts, no per-learner identifiers) and flag it so the
 *     UI suppresses the per-learner list and respects the lack of identifier.
 *   - "joined" = distinct learners who have a row for the lesson (started).
 *     "completed" = learners with learner_progress.completed_at set.
 *   - time-to-completion = completed_at − learner.created_at (the first start).
 *   - per-question distribution joins learner_responses (keyed by slide order)
 *     to the lesson's question slides (content.options + content.correct_index).
 */

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

type AuthMode = 'anonymous' | 'name' | 'email'

function normalizeAuthMode(v: unknown): AuthMode {
  return v === 'anonymous' || v === 'email' ? v : 'name'
}

function parseContent(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Difference in seconds between two ISO timestamps, or null if unparseable. */
function diffSeconds(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null
  return Math.round((e - s) / 1000)
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10 // one decimal, percent
}

// ── Lesson analytics ──────────────────────────────────────────────────────────

interface LessonRow {
  id: string
  title: string
  status: string
  auth_mode: string | null
  estimated_duration_minutes: number | null
}

interface QuestionSlide {
  order: number
  question: string
  options: string[]
  correctIndex: number
}

/** Question slides for a lesson, in order, with options + correct index. */
async function loadQuestionSlides(env: Env, lessonId: string): Promise<QuestionSlide[]> {
  const { results } = await env.DB.prepare(
    `SELECT "order", content FROM lesson_slides
      WHERE lesson_id = ? AND type = 'question' ORDER BY "order" ASC`,
  )
    .bind(lessonId)
    .all<{ order: number; content: string }>()
  return (results ?? []).map((r) => {
    const c = parseContent(r.content)
    const options = Array.isArray(c.options)
      ? c.options.map((o) => (typeof o === 'string' ? o : String(o)))
      : []
    const correctIndex = typeof c.correct_index === 'number' ? c.correct_index : -1
    return {
      order: r.order,
      question: typeof c.question === 'string' ? c.question : '',
      options,
      correctIndex,
    }
  })
}

interface LearnerRow {
  id: string
  identifier: string | null
  created_at: string
}

interface ProgressRow {
  learner_id: string
  current_slide_order: number
  completed_at: string | null
}

/**
 * Compute the analytics payload for one lesson. Returns null if the lesson
 * doesn't exist. The `course_id` argument scopes progress to a course context
 * when the dashboard is reached via a course drill-down (so the same physical
 * lesson taken inside a course is measured independently); when null, lesson
 * analytics aggregate all learners for the lesson regardless of context.
 */
export async function buildLessonAnalytics(
  env: Env,
  lessonId: string,
): Promise<Record<string, unknown> | null> {
  const lesson = await env.DB.prepare(
    `SELECT id, title, status, auth_mode, estimated_duration_minutes
       FROM lessons WHERE id = ?`,
  )
    .bind(lessonId)
    .first<LessonRow>()
  if (!lesson) return null

  const authMode = normalizeAuthMode(lesson.auth_mode)
  const anonymous = authMode === 'anonymous'

  // Learners who started THIS lesson (lesson-scoped rows).
  const { results: learnerRows } = await env.DB.prepare(
    `SELECT id, identifier, created_at FROM learners
      WHERE lesson_id = ? ORDER BY created_at ASC`,
  )
    .bind(lessonId)
    .all<LearnerRow>()
  const learners = learnerRows ?? []
  const learnerIds = new Set(learners.map((l) => l.id))

  // Progress rows for this lesson (one per learner who has any progress).
  const { results: progressRows } = await env.DB.prepare(
    `SELECT learner_id, current_slide_order, completed_at
       FROM learner_progress WHERE lesson_id = ?`,
  )
    .bind(lessonId)
    .all<ProgressRow>()
  const progressByLearner = new Map<string, ProgressRow>()
  for (const p of progressRows ?? []) {
    if (learnerIds.has(p.learner_id)) progressByLearner.set(p.learner_id, p)
  }

  const joined = learners.length
  let completed = 0
  const completionDurations: number[] = []

  // Per-learner rows (suppressed for anonymous; built either way for counts).
  const perLearner = learners.map((l) => {
    const p = progressByLearner.get(l.id)
    const isCompleted = !!p?.completed_at
    let status: 'joined' | 'in-progress' | 'completed' = 'joined'
    if (isCompleted) {
      status = 'completed'
      completed++
      const d = diffSeconds(l.created_at, p!.completed_at)
      if (d !== null) completionDurations.push(d)
    } else if (p && p.current_slide_order > 0) {
      status = 'in-progress'
    }
    return {
      identifier: l.identifier,
      status,
      currentSlideOrder: p?.current_slide_order ?? 0,
      startedAt: l.created_at,
      completedAt: p?.completed_at ?? null,
    }
  })

  const avgTimeToCompleteSeconds =
    completionDurations.length > 0
      ? Math.round(completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length)
      : null

  // Per-question response distribution. Responses are keyed by slide ORDER (text)
  // in learner_responses.lesson_slide_id, scoped to this lesson's learners.
  const questions = await loadQuestionSlides(env, lessonId)
  const distribution = await buildQuestionDistribution(env, learnerIds, questions)

  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      status: lesson.status === 'published' ? 'published' : 'draft',
      authMode,
      estimatedDurationMinutes: lesson.estimated_duration_minutes,
    },
    anonymous,
    stats: {
      joined,
      completed,
      completionRate: rate(completed, joined),
      avgTimeToCompleteSeconds,
      estimatedDurationMinutes: lesson.estimated_duration_minutes,
    },
    // Per-learner list is OWNER-only AND only for identified lessons; anonymous
    // returns null so the UI shows aggregate-only and never invents identifiers.
    learners: anonymous ? null : perLearner,
    questions: distribution,
  }
}

interface QuestionDistribution {
  order: number
  question: string
  options: { index: number; label: string; count: number; isCorrect: boolean }[]
  totalResponses: number
  correctCount: number
  correctRate: number
  mostMissed: boolean
}

/**
 * For each question slide, count how many learners picked each option (from
 * learner_responses keyed by slide order), the % correct, and flag the single
 * most-missed answered question (lowest correctRate among questions with >=1
 * response).
 */
async function buildQuestionDistribution(
  env: Env,
  learnerIds: Set<string>,
  questions: QuestionSlide[],
): Promise<QuestionDistribution[]> {
  if (questions.length === 0 || learnerIds.size === 0) {
    return questions.map((q) => emptyDistribution(q))
  }

  const orders = questions.map((q) => String(q.order))
  // Pull all responses for these learners on these question orders.
  const placeholders = orders.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT learner_id, lesson_slide_id, response_value
       FROM learner_responses
      WHERE lesson_slide_id IN (${placeholders})`,
  )
    .bind(...orders)
    .all<{ learner_id: string; lesson_slide_id: string; response_value: string | null }>()

  // order(text) → array of selected option indices (only from known learners).
  const byOrder = new Map<string, number[]>()
  for (const r of results ?? []) {
    if (!learnerIds.has(r.learner_id)) continue
    let selected = -1
    try {
      const v = r.response_value ? JSON.parse(r.response_value) : null
      if (v && typeof v === 'object' && typeof (v as any).selected === 'number') {
        selected = (v as any).selected
      }
    } catch {
      selected = -1
    }
    const arr = byOrder.get(r.lesson_slide_id) ?? []
    arr.push(selected)
    byOrder.set(r.lesson_slide_id, arr)
  }

  const dists = questions.map((q) => {
    const selections = byOrder.get(String(q.order)) ?? []
    const counts = q.options.map((label, index) => ({
      index,
      label,
      count: selections.filter((s) => s === index).length,
      isCorrect: index === q.correctIndex,
    }))
    const totalResponses = selections.length
    const correctCount = q.correctIndex >= 0
      ? selections.filter((s) => s === q.correctIndex).length
      : 0
    return {
      order: q.order,
      question: q.question,
      options: counts,
      totalResponses,
      correctCount,
      correctRate: rate(correctCount, totalResponses),
      mostMissed: false,
    }
  })

  // Flag the single most-missed answered question (lowest correctRate, >=1 resp).
  let worstIdx = -1
  let worstRate = Infinity
  dists.forEach((d, i) => {
    if (d.totalResponses > 0 && d.correctRate < worstRate) {
      worstRate = d.correctRate
      worstIdx = i
    }
  })
  if (worstIdx >= 0) dists[worstIdx].mostMissed = true

  return dists
}

function emptyDistribution(q: QuestionSlide): QuestionDistribution {
  return {
    order: q.order,
    question: q.question,
    options: q.options.map((label, index) => ({
      index,
      label,
      count: 0,
      isCorrect: index === q.correctIndex,
    })),
    totalResponses: 0,
    correctCount: 0,
    correctRate: 0,
    mostMissed: false,
  }
}

/** GET /api/courses/lessons/:id/analytics — owner-only lesson dashboard data. */
export async function getLessonAnalytics(env: Env, lessonId: string): Promise<Response> {
  const data = await buildLessonAnalytics(env, lessonId)
  if (!data) return json({ error: 'Lesson not found' }, 404)
  return json(data)
}

// ── Course analytics ────────────────────────────────────────────────────────

interface CourseRow {
  id: string
  title: string
  status: string
  auth_mode: string | null
}

interface MemberRow {
  lesson_id: string
  title: string
  order: number
  estimated_duration_minutes: number | null
}

/**
 * Course dashboard: course-level totals + per-lesson breakdown with drop-off.
 *
 * Course-level "joined"/"completed" are measured over COURSE learners
 * (learners.course_id set). A course learner is "completed" when they have
 * completed EVERY member lesson (mirrors the public progress derivation). Per-
 * lesson breakdown counts the lesson-scoped learners produced by the per-lesson
 * player, with drop-off = started − completed for that lesson.
 */
export async function getCourseAnalytics(env: Env, courseId: string): Promise<Response> {
  const course = await env.DB.prepare(
    `SELECT id, title, status, auth_mode FROM courses WHERE id = ?`,
  )
    .bind(courseId)
    .first<CourseRow>()
  if (!course) return json({ error: 'Course not found' }, 404)

  const authMode = normalizeAuthMode(course.auth_mode)
  const anonymous = authMode === 'anonymous'

  const { results: memberRows } = await env.DB.prepare(
    `SELECT cl.lesson_id AS lesson_id, l.title AS title, cl."order" AS "order",
            l.estimated_duration_minutes AS estimated_duration_minutes
       FROM course_lessons cl
       JOIN lessons l ON l.id = cl.lesson_id
      WHERE cl.course_id = ?
      ORDER BY cl."order" ASC`,
  )
    .bind(courseId)
    .all<MemberRow>()
  const members = memberRows ?? []

  // Per-lesson breakdown: started/completed/drop-off over lesson-scoped learners.
  const perLesson = [] as Record<string, unknown>[]
  for (const m of members) {
    const startedRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM learners WHERE lesson_id = ?`,
    )
      .bind(m.lesson_id)
      .first<{ n: number }>()
    const started = startedRow?.n ?? 0
    const completedRow = await env.DB.prepare(
      `SELECT COUNT(DISTINCT lp.learner_id) AS n
         FROM learner_progress lp
         JOIN learners le ON le.id = lp.learner_id
        WHERE lp.lesson_id = ? AND le.lesson_id = ? AND lp.completed_at IS NOT NULL`,
    )
      .bind(m.lesson_id, m.lesson_id)
      .first<{ n: number }>()
    const lessonCompleted = completedRow?.n ?? 0
    perLesson.push({
      lessonId: m.lesson_id,
      title: m.title,
      order: m.order,
      estimatedDurationMinutes: m.estimated_duration_minutes,
      started,
      completed: lessonCompleted,
      dropOff: Math.max(0, started - lessonCompleted),
      completionRate: rate(lessonCompleted, started),
    })
  }

  // Course-level totals over COURSE learners (course_id set, lesson_id NULL).
  const { results: courseLearners } = await env.DB.prepare(
    `SELECT id, created_at FROM learners
      WHERE course_id = ? AND course_id <> '' AND lesson_id IS NULL`,
  )
    .bind(courseId)
    .all<{ id: string; created_at: string }>()
  const cLearners = courseLearners ?? []

  const memberLessonIds = members.map((m) => m.lesson_id)
  let courseCompleted = 0
  const courseDurations: number[] = []
  for (const cl of cLearners) {
    if (memberLessonIds.length === 0) break
    // Completed lesson ids for this course learner, scoped to this course.
    const { results: doneRows } = await env.DB.prepare(
      `SELECT lesson_id, completed_at FROM learner_progress
        WHERE learner_id = ? AND course_id = ? AND completed_at IS NOT NULL`,
    )
      .bind(cl.id, courseId)
      .all<{ lesson_id: string; completed_at: string }>()
    const done = doneRows ?? []
    const doneSet = new Set(done.map((d) => d.lesson_id))
    const allDone = memberLessonIds.every((lid) => doneSet.has(lid))
    if (allDone) {
      courseCompleted++
      // time-to-complete = first start → last lesson completion.
      const lastCompletedAt = done
        .map((d) => d.completed_at)
        .sort()
        .slice(-1)[0]
      const d = diffSeconds(cl.created_at, lastCompletedAt)
      if (d !== null) courseDurations.push(d)
    }
  }

  const courseJoined = cLearners.length
  const avgTimeToCompleteSeconds =
    courseDurations.length > 0
      ? Math.round(courseDurations.reduce((a, b) => a + b, 0) / courseDurations.length)
      : null

  return json({
    course: {
      id: course.id,
      title: course.title,
      status: course.status === 'published' ? 'published' : course.status === 'unpublished' ? 'unpublished' : 'draft',
      authMode,
    },
    anonymous,
    stats: {
      joined: courseJoined,
      completed: courseCompleted,
      completionRate: rate(courseCompleted, courseJoined),
      avgTimeToCompleteSeconds,
    },
    lessons: perLesson,
  })
}
