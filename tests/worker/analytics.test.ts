/**
 * WAT-15 (Stage 7) — CF Worker integration tests for the OWNER analytics
 * endpoints over the Courses learner tables. Runs INSIDE workerd (Miniflare)
 * with the REAL D1 binding (`env.DB`).
 *
 * Covers:
 *   - GET /api/courses/lessons/:id/analytics
 *       · joined / completed / completionRate math
 *       · per-learner rows (identifier + status joined/in-progress/completed)
 *       · ANONYMOUS lesson → aggregate-only (learners == null, no identifiers)
 *       · per-question response distribution counts + most-missed flag
 *       · avg time-to-completion vs estimated duration
 *       · 404 for an unknown lesson
 *   - GET /api/courses/:id/analytics
 *       · per-lesson breakdown (started/completed/drop-off)
 *       · course-level joined/completed over course learners
 *       · 404 for an unknown course
 */

import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, it, expect } from 'vitest'

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
}

const ORIGIN = 'https://example.com'

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM learner_responses')
  await env.DB.exec('DELETE FROM learner_progress')
  await env.DB.exec('DELETE FROM learners')
  await env.DB.exec('DELETE FROM lesson_slides')
  await env.DB.exec('DELETE FROM course_lessons')
  await env.DB.exec('DELETE FROM courses')
  await env.DB.exec('DELETE FROM lessons')
})

function api(path: string, method = 'GET', body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/** Insert a lesson + its question/explanation slides. Returns the lesson id. */
async function makeLesson(opts: {
  id: string
  authMode?: string
  durationMin?: number
  // each question: { correct } correct option index; produces 4 options.
  questions: { correct: number }[]
}): Promise<string> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO lessons
       (id, presentation_id, title, description, slides, status,
        created_at, updated_at,
        source_presentation_id, estimated_duration_minutes, language, reviewed,
        share_link_slug, auth_mode)
     VALUES (?, 1, ?, '', '[]', 'published', ?, ?, 1, ?, 'en', 1, ?, ?)`,
  )
    .bind(
      opts.id,
      `Lesson ${opts.id}`,
      now,
      now,
      opts.durationMin ?? 5,
      `slug_${opts.id}`,
      opts.authMode ?? 'name',
    )
    .run()

  let order = 0
  for (let qi = 0; qi < opts.questions.length; qi++) {
    const q = opts.questions[qi]
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'question', ?)`,
    )
      .bind(
        `${opts.id}_q${qi}`,
        opts.id,
        order++,
        JSON.stringify({
          question: `Q${qi + 1}?`,
          options: ['a', 'b', 'c', 'd'],
          correct_index: q.correct,
        }),
      )
      .run()
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'explanation', ?)`,
    )
      .bind(`${opts.id}_e${qi}`, opts.id, order++, JSON.stringify({ explanation: 'because' }))
      .run()
  }
  return opts.id
}

/** Insert a lesson-scoped learner. Returns the learner id. */
async function makeLearner(opts: {
  id: string
  lessonId: string
  identifier?: string | null
  startedAt: string
}): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO learners (id, course_id, lesson_id, identifier, created_at) VALUES (?, '', ?, ?, ?)`,
  )
    .bind(opts.id, opts.lessonId, opts.identifier ?? null, opts.startedAt)
    .run()
  return opts.id
}

async function makeProgress(opts: {
  learnerId: string
  lessonId: string
  courseId?: string | null
  currentSlideOrder?: number
  completedAt?: string | null
}) {
  await env.DB.prepare(
    `INSERT INTO learner_progress
       (id, learner_id, lesson_id, course_id, current_slide_order, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.learnerId,
      opts.lessonId,
      opts.courseId ?? null,
      opts.currentSlideOrder ?? 0,
      opts.completedAt ?? null,
    )
    .run()
}

async function makeResponse(learnerId: string, slideOrder: number, selected: number, correct: boolean) {
  await env.DB.prepare(
    `INSERT INTO learner_responses (id, learner_id, lesson_slide_id, response_value, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), learnerId, String(slideOrder), JSON.stringify({ selected, correct }), new Date().toISOString())
    .run()
}

// ── Lesson analytics ──────────────────────────────────────────────────────────
describe('GET /api/courses/lessons/:id/analytics', () => {
  it('404s for an unknown lesson', async () => {
    const res = await api('/api/courses/lessons/nope/analytics')
    expect(res.status).toBe(404)
  })

  it('computes joined / completed / completionRate and per-learner rows', async () => {
    const lid = await makeLesson({ id: 'L1', authMode: 'name', durationMin: 10, questions: [{ correct: 0 }, { correct: 2 }] })
    // 3 joined: 1 completed, 1 in-progress, 1 just-joined.
    await makeLearner({ id: 'la', lessonId: lid, identifier: 'Alice', startedAt: '2026-06-01T10:00:00.000Z' })
    await makeProgress({ learnerId: 'la', lessonId: lid, currentSlideOrder: 4, completedAt: '2026-06-01T10:05:00.000Z' })
    await makeLearner({ id: 'lb', lessonId: lid, identifier: 'Bob', startedAt: '2026-06-01T10:00:00.000Z' })
    await makeProgress({ learnerId: 'lb', lessonId: lid, currentSlideOrder: 2, completedAt: null })
    await makeLearner({ id: 'lc', lessonId: lid, identifier: 'Cara', startedAt: '2026-06-01T10:00:00.000Z' })

    const res = await api(`/api/courses/lessons/${lid}/analytics`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.anonymous).toBe(false)
    expect(body.stats.joined).toBe(3)
    expect(body.stats.completed).toBe(1)
    expect(body.stats.completionRate).toBeCloseTo(33.3, 1)
    expect(body.learners).toHaveLength(3)
    const byId = Object.fromEntries(body.learners.map((l: any) => [l.identifier, l.status]))
    expect(byId).toEqual({ Alice: 'completed', Bob: 'in-progress', Cara: 'joined' })
    // avg time-to-complete = 5 minutes = 300s; estimate 10 min.
    expect(body.stats.avgTimeToCompleteSeconds).toBe(300)
    expect(body.stats.estimatedDurationMinutes).toBe(10)
  })

  it('ANONYMOUS lesson → aggregate-only (learners null, no identifiers)', async () => {
    const lid = await makeLesson({ id: 'A1', authMode: 'anonymous', questions: [{ correct: 0 }] })
    // Even if rows exist, identifiers must not be exposed and learners must be null.
    await makeLearner({ id: 'lx', lessonId: lid, identifier: null, startedAt: '2026-06-01T10:00:00.000Z' })
    await makeProgress({ learnerId: 'lx', lessonId: lid, currentSlideOrder: 2, completedAt: '2026-06-01T10:02:00.000Z' })

    const res = await api(`/api/courses/lessons/${lid}/analytics`)
    const body = (await res.json()) as any
    expect(body.anonymous).toBe(true)
    expect(body.learners).toBeNull()
    // Aggregate stats still computed.
    expect(body.stats.joined).toBe(1)
    expect(body.stats.completed).toBe(1)
  })

  it('per-question distribution counts option picks, % correct, and flags most-missed', async () => {
    // Q1 (order 0) correct = 0 ; Q2 (order 2) correct = 2.
    const lid = await makeLesson({ id: 'L2', authMode: 'name', questions: [{ correct: 0 }, { correct: 2 }] })
    await makeLearner({ id: 'l1', lessonId: lid, identifier: 'p1', startedAt: '2026-06-01T10:00:00.000Z' })
    await makeLearner({ id: 'l2', lessonId: lid, identifier: 'p2', startedAt: '2026-06-01T10:00:00.000Z' })
    await makeLearner({ id: 'l3', lessonId: lid, identifier: 'p3', startedAt: '2026-06-01T10:00:00.000Z' })
    // Q1 order 0: all 3 pick 0 → 100% correct.
    await makeResponse('l1', 0, 0, true)
    await makeResponse('l2', 0, 0, true)
    await makeResponse('l3', 0, 0, true)
    // Q2 order 2: only 1 of 3 picks 2 (correct), others pick 1 → 33% correct (most missed).
    await makeResponse('l1', 2, 2, true)
    await makeResponse('l2', 2, 1, false)
    await makeResponse('l3', 2, 1, false)

    const res = await api(`/api/courses/lessons/${lid}/analytics`)
    const body = (await res.json()) as any
    expect(body.questions).toHaveLength(2)

    const q1 = body.questions.find((q: any) => q.order === 0)
    expect(q1.totalResponses).toBe(3)
    expect(q1.correctRate).toBe(100)
    expect(q1.options[0].count).toBe(3)
    expect(q1.options[0].isCorrect).toBe(true)
    expect(q1.mostMissed).toBe(false)

    const q2 = body.questions.find((q: any) => q.order === 2)
    expect(q2.totalResponses).toBe(3)
    expect(q2.options[2].count).toBe(1)
    expect(q2.options[1].count).toBe(2)
    expect(q2.correctRate).toBeCloseTo(33.3, 1)
    expect(q2.mostMissed).toBe(true) // lowest correct rate of the two questions
  })

  it('standalone lesson (zero courses) — start→analytics round trip', async () => {
    // This test proves that a lesson that has NEVER been added to any course
    // still works fully: learners can start via the public API and the dashboard
    // returns correct data. The learner row has course_id='' (sentinel, NOT NULL)
    // and lesson_id set — the analytics queries exclusively on lesson_id.
    const lid = await makeLesson({
      id: 'SA1',
      authMode: 'name',
      durationMin: 5,
      questions: [{ correct: 1 }],
    })
    // Publish the lesson so /learn/:slug/start accepts it.
    const now = new Date().toISOString()
    const snapshot = JSON.stringify([
      { order: 0, type: 'question', content: { question: 'Q?', options: ['a', 'b', 'c', 'd'], correct_index: 1 } },
      { order: 1, type: 'explanation', content: { explanation: 'Because b.' } },
    ])
    await env.DB.prepare(
      `UPDATE lessons
          SET status='published', share_link_slug='slug_sa1',
              published_title='SA Lesson', published_slides_json=?, published_at=?
        WHERE id='SA1'`,
    )
      .bind(snapshot, now)
      .run()

    // Start learner via the public API — no course involved.
    const startRes = await api('/api/learn/slug_sa1/start', 'POST', { identifier: 'Solo' })
    expect(startRes.status).toBe(200)
    const { learnerId } = (await startRes.json()) as any
    expect(learnerId).toBeTruthy()

    // Mark progress.
    await api('/api/learn/slug_sa1/progress', 'POST', { learnerId, currentSlideOrder: 2, completed: true })

    // Dashboard should see 1 learner, 1 completed.
    const dashRes = await api(`/api/courses/lessons/${lid}/analytics`)
    expect(dashRes.status).toBe(200)
    const body = (await dashRes.json()) as any
    expect(body.stats.joined).toBe(1)
    expect(body.stats.completed).toBe(1)
    expect(body.stats.completionRate).toBe(100)
    expect(body.learners).toHaveLength(1)
    expect(body.learners[0].identifier).toBe('Solo')
    expect(body.learners[0].status).toBe('completed')

    // Confirm the learner row in DB uses the sentinel pattern (course_id='').
    const row = await env.DB.prepare(`SELECT course_id, lesson_id FROM learners WHERE id=?`)
      .bind(learnerId)
      .first<{ course_id: string; lesson_id: string }>()
    expect(row?.course_id).toBe('')
    expect(row?.lesson_id).toBe('SA1')
  })

  it('ignores responses from learners not on this lesson', async () => {
    const lid = await makeLesson({ id: 'L3', authMode: 'name', questions: [{ correct: 0 }] })
    await makeLearner({ id: 'mine', lessonId: lid, identifier: 'p', startedAt: '2026-06-01T10:00:00.000Z' })
    await makeResponse('mine', 0, 0, true)
    // A stray response from an unrelated learner id on the same slide order.
    await makeResponse('stranger', 0, 1, false)

    const res = await api(`/api/courses/lessons/${lid}/analytics`)
    const body = (await res.json()) as any
    const q = body.questions[0]
    expect(q.totalResponses).toBe(1)
    expect(q.options[0].count).toBe(1)
  })
})

// ── Course analytics ─────────────────────────────────────────────────────────
describe('GET /api/courses/:id/analytics', () => {
  it('404s for an unknown course', async () => {
    const res = await api('/api/courses/nope/analytics')
    expect(res.status).toBe(404)
  })

  it('per-lesson breakdown with started / completed / drop-off', async () => {
    const l1 = await makeLesson({ id: 'CL1', authMode: 'name', questions: [{ correct: 0 }] })
    const l2 = await makeLesson({ id: 'CL2', authMode: 'name', questions: [{ correct: 0 }] })
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO courses (id, title, description, auth_mode, order_mode, status, created_at, updated_at)
       VALUES ('C1', 'Course', '', 'name', 'free', 'published', ?, ?)`,
    )
      .bind(now, now)
      .run()
    await env.DB.prepare(`INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES ('cl1','C1',?,0)`)
      .bind(l1)
      .run()
    await env.DB.prepare(`INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES ('cl2','C1',?,1)`)
      .bind(l2)
      .run()

    // Lesson 1: 2 started, 1 completed → drop-off 1.
    await makeLearner({ id: 'a', lessonId: l1, identifier: 'A', startedAt: now })
    await makeProgress({ learnerId: 'a', lessonId: l1, completedAt: now })
    await makeLearner({ id: 'b', lessonId: l1, identifier: 'B', startedAt: now })
    await makeProgress({ learnerId: 'b', lessonId: l1, completedAt: null })
    // Lesson 2: 1 started, 0 completed → drop-off 1.
    await makeLearner({ id: 'c', lessonId: l2, identifier: 'C', startedAt: now })

    const res = await api('/api/courses/C1/analytics')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.lessons).toHaveLength(2)
    const b1 = body.lessons.find((x: any) => x.lessonId === l1)
    expect(b1.started).toBe(2)
    expect(b1.completed).toBe(1)
    expect(b1.dropOff).toBe(1)
    expect(b1.completionRate).toBe(50)
    const b2 = body.lessons.find((x: any) => x.lessonId === l2)
    expect(b2.started).toBe(1)
    expect(b2.completed).toBe(0)
    expect(b2.dropOff).toBe(1)
  })

  it('course-level joined/completed over course learners (all member lessons done)', async () => {
    const l1 = await makeLesson({ id: 'CC1', authMode: 'name', questions: [{ correct: 0 }] })
    const l2 = await makeLesson({ id: 'CC2', authMode: 'name', questions: [{ correct: 0 }] })
    const start = '2026-06-01T09:00:00.000Z'
    const end = '2026-06-01T09:20:00.000Z'
    await env.DB.prepare(
      `INSERT INTO courses (id, title, description, auth_mode, order_mode, status, created_at, updated_at)
       VALUES ('C2', 'Course2', '', 'name', 'free', 'published', ?, ?)`,
    )
      .bind(start, start)
      .run()
    await env.DB.prepare(`INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES ('m1','C2',?,0)`).bind(l1).run()
    await env.DB.prepare(`INSERT INTO course_lessons (id, course_id, lesson_id, "order") VALUES ('m2','C2',?,1)`).bind(l2).run()

    // Course learner who completed BOTH member lessons → counts as completed.
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, lesson_id, identifier, created_at) VALUES ('cl', 'C2', NULL, 'Dana', ?)`,
    )
      .bind(start)
      .run()
    await makeProgress({ learnerId: 'cl', lessonId: l1, courseId: 'C2', completedAt: '2026-06-01T09:10:00.000Z' })
    await makeProgress({ learnerId: 'cl', lessonId: l2, courseId: 'C2', completedAt: end })
    // A second course learner who finished only ONE → not completed.
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, lesson_id, identifier, created_at) VALUES ('cl2', 'C2', NULL, 'Evan', ?)`,
    )
      .bind(start)
      .run()
    await makeProgress({ learnerId: 'cl2', lessonId: l1, courseId: 'C2', completedAt: end })

    const res = await api('/api/courses/C2/analytics')
    const body = (await res.json()) as any
    expect(body.stats.joined).toBe(2)
    expect(body.stats.completed).toBe(1)
    expect(body.stats.completionRate).toBe(50)
    // time-to-complete for Dana = 09:00 → 09:20 = 1200s.
    expect(body.stats.avgTimeToCompleteSeconds).toBe(1200)
  })

  it('ANONYMOUS course → aggregate-only flag set', async () => {
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO courses (id, title, description, auth_mode, order_mode, status, created_at, updated_at)
       VALUES ('C3', 'Anon', '', 'anonymous', 'free', 'published', ?, ?)`,
    )
      .bind(now, now)
      .run()
    const res = await api('/api/courses/C3/analytics')
    const body = (await res.json()) as any
    expect(body.anonymous).toBe(true)
    expect(body.stats.joined).toBe(0)
  })
})
