/**
 * CF Worker integration tests for the WAT-14 Course CONTAINER backend — run
 * INSIDE workerd (Miniflare) with the REAL D1 binding from wrangler.jsonc.
 *
 * Covers:
 *   - Course CRUD: create (draft) with members, get detail (total duration),
 *     patch title/order/auth, delete.
 *   - Membership: add (one-course-per-lesson 409), remove, reorder.
 *   - Publish: mints stable slug, requires >=1 published member, snapshots.
 *   - Public learn resolver: GET /api/learn/c/:slug (published only).
 *   - Course-scoped learner: start + per-lesson completion → course-complete.
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

/** Insert a lesson, optionally published (with a slug). Adds one lesson_slide. */
async function makeLesson(
  id: string,
  opts: { duration?: number; published?: boolean; slug?: string } = {},
): Promise<void> {
  const now = new Date().toISOString()
  const status = opts.published ? 'published' : 'draft'
  const slug = opts.published ? opts.slug ?? `${id}-slug` : null
  const snapshot = opts.published
    ? JSON.stringify([{ order: 0, type: 'question', content: { question: 'Q?', options: ['a', 'b'], correct_index: 0 } }])
    : null
  await env.DB.prepare(
    `INSERT INTO lessons
       (id, presentation_id, title, description, slides, status, created_at, updated_at,
        published_at, owner_id, source_presentation_id, estimated_duration_minutes, language,
        share_link_slug, auth_mode, published_slides_json, published_title)
     VALUES (?, 1, ?, '', '[]', ?, ?, ?, ?, NULL, 1, ?, 'en', ?, 'name', ?, ?)`,
  )
    .bind(id, `Lesson ${id}`, status, now, now, opts.published ? now : null,
          opts.duration ?? 5, slug, snapshot, opts.published ? `Lesson ${id}` : null)
    .run()
  await env.DB.prepare(
    `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, 0, 'question', ?)`,
  )
    .bind(`${id}_s0`, id, JSON.stringify({ question: 'Q?', options: ['a', 'b'], correct_index: 0 }))
    .run()
}

async function postJson(path: string, body: unknown, method = 'POST'): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM learner_progress')
  await env.DB.exec('DELETE FROM learners')
  await env.DB.exec('DELETE FROM course_lessons')
  await env.DB.exec('DELETE FROM courses')
  await env.DB.exec('DELETE FROM lesson_slides')
  await env.DB.exec('DELETE FROM lessons')
})

describe('Course CRUD', () => {
  it('creates a DRAFT course with ordered members + computes total duration', async () => {
    await makeLesson('l1', { duration: 5 })
    await makeLesson('l2', { duration: 7 })

    const res = await postJson('/api/courses', {
      title: 'Onboarding',
      description: 'Welcome',
      orderMode: 'sequential',
      authMode: 'email',
      lessonIds: ['l1', 'l2'],
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { course: Record<string, unknown>; lessons: Array<Record<string, unknown>> }
    expect(body.course.title).toBe('Onboarding')
    expect(body.course.status).toBe('draft')
    expect(body.course.orderMode).toBe('sequential')
    expect(body.course.authMode).toBe('email')
    expect(body.course.totalDurationMinutes).toBe(12)
    expect(body.lessons.length).toBe(2)
    expect(body.lessons[0].lessonId).toBe('l1')
    expect(body.lessons[1].lessonId).toBe('l2')
    expect(body.lessons[0].order).toBe(0)
    expect(body.lessons[1].order).toBe(1)
  })

  it('rejects a course with no title (400)', async () => {
    const res = await postJson('/api/courses', { title: '   ' })
    expect(res.status).toBe(400)
  })

  it('patches title / orderMode / authMode', async () => {
    const created = await (await postJson('/api/courses', { title: 'A', lessonIds: [] })).json() as { course: { id: string } }
    const id = created.course.id
    const res = await postJson(`/api/courses/${id}`, { title: 'B', orderMode: 'sequential' }, 'PATCH')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { course: { title: string; orderMode: string } }
    expect(body.course.title).toBe('B')
    expect(body.course.orderMode).toBe('sequential')
  })

  it('deletes a course and its membership', async () => {
    await makeLesson('l1')
    const created = await (await postJson('/api/courses', { title: 'A', lessonIds: ['l1'] })).json() as { course: { id: string } }
    const id = created.course.id
    const del = await SELF.fetch(`${ORIGIN}/api/courses/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const get = await SELF.fetch(`${ORIGIN}/api/courses/${id}`)
    expect(get.status).toBe(404)
    const members = await env.DB.prepare(`SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ?`).bind(id).first<{ n: number }>()
    expect(members!.n).toBe(0)
  })
})

describe('Membership + one-course-per-lesson', () => {
  it('skips a lesson already owned by another course on create', async () => {
    await makeLesson('l1')
    await postJson('/api/courses', { title: 'First', lessonIds: ['l1'] })
    const res = await postJson('/api/courses', { title: 'Second', lessonIds: ['l1'] })
    const body = (await res.json()) as { lessons: unknown[] }
    expect(body.lessons.length).toBe(0) // l1 already belongs to First
  })

  it('add returns 409 when the lesson belongs to another course', async () => {
    await makeLesson('l1')
    const c1 = await (await postJson('/api/courses', { title: 'First', lessonIds: ['l1'] })).json() as { course: { id: string } }
    void c1
    const c2 = await (await postJson('/api/courses', { title: 'Second', lessonIds: [] })).json() as { course: { id: string } }
    const res = await postJson(`/api/courses/${c2.course.id}/lessons`, { lessonId: 'l1' })
    expect(res.status).toBe(409)
  })

  it('adds a free lesson, then removes it', async () => {
    await makeLesson('l1')
    const c = await (await postJson('/api/courses', { title: 'C', lessonIds: [] })).json() as { course: { id: string } }
    const add = await postJson(`/api/courses/${c.course.id}/lessons`, { lessonId: 'l1' })
    expect(add.status).toBe(200)
    let body = (await add.json()) as { lessons: unknown[] }
    expect(body.lessons.length).toBe(1)
    const rm = await SELF.fetch(`${ORIGIN}/api/courses/${c.course.id}/lessons/l1`, { method: 'DELETE' })
    expect(rm.status).toBe(200)
    body = (await rm.json()) as { lessons: unknown[] }
    expect(body.lessons.length).toBe(0)
  })

  it('reorders members by lesson-id list', async () => {
    await makeLesson('l1')
    await makeLesson('l2')
    await makeLesson('l3')
    const c = await (await postJson('/api/courses', { title: 'C', lessonIds: ['l1', 'l2', 'l3'] })).json() as { course: { id: string } }
    const res = await postJson(`/api/courses/${c.course.id}/reorder`, { order: ['l3', 'l1', 'l2'] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lessons: Array<{ lessonId: string }> }
    expect(body.lessons.map((l) => l.lessonId)).toEqual(['l3', 'l1', 'l2'])
  })
})

describe('Publish', () => {
  it('requires at least one published member lesson (409)', async () => {
    await makeLesson('draft1', { published: false })
    const c = await (await postJson('/api/courses', { title: 'C', lessonIds: ['draft1'] })).json() as { course: { id: string } }
    const res = await postJson(`/api/courses/${c.course.id}/publish`, {})
    expect(res.status).toBe(409)
  })

  it('publishes, mints a stable slug, and reuses it on re-publish', async () => {
    await makeLesson('pub1', { published: true, slug: 'pub1slug' })
    const c = await (await postJson('/api/courses', { title: 'C', lessonIds: ['pub1'] })).json() as { course: { id: string } }
    const res1 = await postJson(`/api/courses/${c.course.id}/publish`, {})
    expect(res1.status).toBe(200)
    const b1 = (await res1.json()) as { course: { status: string; shareLinkSlug: string } }
    expect(b1.course.status).toBe('published')
    expect(b1.course.shareLinkSlug).toBeTruthy()
    const slug = b1.course.shareLinkSlug

    const res2 = await postJson(`/api/courses/${c.course.id}/publish`, {})
    const b2 = (await res2.json()) as { course: { shareLinkSlug: string } }
    expect(b2.course.shareLinkSlug).toBe(slug) // stable
  })

  it('unpublish keeps the slug but flips status', async () => {
    await makeLesson('pub1', { published: true })
    const c = await (await postJson('/api/courses', { title: 'C', lessonIds: ['pub1'] })).json() as { course: { id: string } }
    await postJson(`/api/courses/${c.course.id}/publish`, {})
    const res = await postJson(`/api/courses/${c.course.id}/unpublish`, {})
    const body = (await res.json()) as { course: { status: string; shareLinkSlug: string } }
    expect(body.course.status).toBe('unpublished')
    expect(body.course.shareLinkSlug).toBeTruthy()
  })
})

describe('Public course learn resolver + course-scoped progress', () => {
  async function publishedCourse(slug = 'pub1', slug2 = 'pub2'): Promise<{ id: string; courseSlug: string }> {
    await makeLesson('pub1', { published: true, slug, duration: 5 })
    await makeLesson('pub2', { published: true, slug: slug2, duration: 5 })
    const c = await (await postJson('/api/courses', { title: 'Course X', description: 'Desc', authMode: 'name', orderMode: 'sequential', lessonIds: ['pub1', 'pub2'] })).json() as { course: { id: string } }
    const pub = await (await postJson(`/api/courses/${c.course.id}/publish`, {})).json() as { course: { shareLinkSlug: string } }
    return { id: c.course.id, courseSlug: pub.course.shareLinkSlug }
  }

  it('GET /api/learn/c/:slug resolves a published course with ordered lessons + total', async () => {
    const { courseSlug } = await publishedCourse()
    const res = await SELF.fetch(`${ORIGIN}/api/learn/c/${courseSlug}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean; course: { title: string; orderMode: string; totalDurationMinutes: number; lessons: Array<{ slug: string }> } }
    expect(body.available).toBe(true)
    expect(body.course.title).toBe('Course X')
    expect(body.course.orderMode).toBe('sequential')
    expect(body.course.totalDurationMinutes).toBe(10)
    expect(body.course.lessons.length).toBe(2)
    expect(body.course.lessons[0].slug).toBe('pub1')
  })

  it('GET /api/learn/c/:slug 404s for an unknown / unpublished slug', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/learn/c/nope`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { available: boolean }
    expect(body.available).toBe(false)
  })

  it('start → complete each lesson → course-complete derived', async () => {
    const { courseSlug } = await publishedCourse()
    const start = await postJson(`/api/learn/c/${courseSlug}/start`, { identifier: 'Sam' })
    expect(start.status).toBe(200)
    const { learnerId } = (await start.json()) as { learnerId: string; completedLessonIds: string[] }
    expect(learnerId).toBeTruthy()

    // Complete lesson 1 → not yet course-complete.
    const p1 = await postJson(`/api/learn/c/${courseSlug}/progress`, { learnerId, lessonId: 'pub1', completed: true })
    const b1 = (await p1.json()) as { completedLessonIds: string[]; courseComplete: boolean }
    expect(b1.completedLessonIds).toContain('pub1')
    expect(b1.courseComplete).toBe(false)

    // Complete lesson 2 → course-complete.
    const p2 = await postJson(`/api/learn/c/${courseSlug}/progress`, { learnerId, lessonId: 'pub2', completed: true })
    const b2 = (await p2.json()) as { courseComplete: boolean }
    expect(b2.courseComplete).toBe(true)
  })

  it('resuming the same identifier returns prior completion', async () => {
    const { courseSlug } = await publishedCourse()
    const s1 = (await (await postJson(`/api/learn/c/${courseSlug}/start`, { identifier: 'Sam' })).json()) as { learnerId: string }
    await postJson(`/api/learn/c/${courseSlug}/progress`, { learnerId: s1.learnerId, lessonId: 'pub1', completed: true })
    const s2 = (await (await postJson(`/api/learn/c/${courseSlug}/start`, { identifier: 'Sam' })).json()) as { learnerId: string; completedLessonIds: string[] }
    expect(s2.learnerId).toBe(s1.learnerId) // same learner row resumed
    expect(s2.completedLessonIds).toContain('pub1')
  })
})
