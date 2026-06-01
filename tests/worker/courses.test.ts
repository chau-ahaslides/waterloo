/**
 * CF Worker integration tests for the Courses-feature (WAT-8 foundation +
 * WAT-10 /api/courses/lessons list endpoint) — run INSIDE workerd (via
 * Miniflare) with the REAL D1 binding (`env.DB`) from wrangler.jsonc.
 *
 * The migrations (incl. 0003_courses_foundation) are applied per file via
 * applyD1Migrations so the schema matches production.
 *
 * Covers:
 *   WAT-8:
 *     1. The 7 Courses-feature tables exist after migration.
 *     2. The new nullable columns were added to the existing `lessons` table.
 *     3. Basic insert/select round-trips on a couple of the new tables.
 *     4. The /api/courses stub routes respond (501 + 405 where expected).
 *   WAT-10:
 *     5. GET /api/courses/lessons returns 200 and the normalized lessons list.
 *     6. Only lessons WITH lesson_slides rows are returned (not legacy blobs).
 *     7. Lessons are ordered by created_at DESC.
 *     8. 405 for non-GET on /api/courses/lessons.
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

describe('WAT-8 migration — Courses-feature tables exist', () => {
  it('creates all 7 model tables (+ keeps the live attempts/lessons tables)', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    ).all<{ name: string }>()
    const names = (results ?? []).map((r) => r.name)

    // New Courses-feature tables.
    expect(names).toContain('lesson_slides')
    expect(names).toContain('courses')
    expect(names).toContain('course_lessons')
    expect(names).toContain('learners')
    expect(names).toContain('learner_progress')
    expect(names).toContain('learner_responses')

    // Existing live tables must NOT have been dropped.
    expect(names).toContain('lessons')
    expect(names).toContain('attempts')
  })

  it('adds the new nullable columns to the existing lessons table', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('lessons')`,
    ).all<{ name: string }>()
    const cols = (results ?? []).map((r) => r.name)

    expect(cols).toContain('owner_id')
    expect(cols).toContain('source_presentation_id')
    expect(cols).toContain('estimated_duration_minutes')
    expect(cols).toContain('language')
    // Legacy columns are preserved.
    expect(cols).toContain('presentation_id')
    expect(cols).toContain('slides')
  })
})

describe('WAT-8 migration — basic insert/select round-trips', () => {
  it('inserts + reads back a course', async () => {
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO courses
         (id, title, description, owner_id, share_link_slug, auth_mode,
          order_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('course_1', 'Onboarding 101', 'A course', 'user_1', 'onboarding-101',
            'email', 'sequential', 'draft', now, now)
      .run()

    const row = await env.DB.prepare(
      `SELECT id, title, auth_mode, order_mode, status FROM courses WHERE id = ?`,
    )
      .bind('course_1')
      .first<{ id: string; title: string; auth_mode: string; order_mode: string; status: string }>()

    expect(row).not.toBeNull()
    expect(row!.title).toBe('Onboarding 101')
    expect(row!.auth_mode).toBe('email')
    expect(row!.order_mode).toBe('sequential')
    expect(row!.status).toBe('draft')
  })

  it('inserts + reads back a lesson_slide with a JSON content blob', async () => {
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind('ls_1', 'lesson_1', 0, 'question', JSON.stringify({ q: 'OK?' }))
      .run()

    const row = await env.DB.prepare(
      `SELECT id, lesson_id, "order", type, content FROM lesson_slides WHERE id = ?`,
    )
      .bind('ls_1')
      .first<{ id: string; lesson_id: string; order: number; type: string; content: string }>()

    expect(row).not.toBeNull()
    expect(row!.lesson_id).toBe('lesson_1')
    expect(row!.type).toBe('question')
    expect(JSON.parse(row!.content)).toEqual({ q: 'OK?' })
  })

  it('allows an anonymous learner (null identifier)', async () => {
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, identifier, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind('learner_1', 'course_1', null, now)
      .run()

    const row = await env.DB.prepare(
      `SELECT identifier FROM learners WHERE id = ?`,
    )
      .bind('learner_1')
      .first<{ identifier: string | null }>()

    expect(row).not.toBeNull()
    expect(row!.identifier).toBeNull()
  })
})

describe('WAT-8 — /api/courses stub routes', () => {
  it('GET /api/courses → 501 Not Implemented', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses`)
    expect(res.status).toBe(501)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Not Implemented')
  })

  it('POST /api/courses → 501 Not Implemented', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses`, { method: 'POST' })
    expect(res.status).toBe(501)
  })

  it('GET /api/courses/:id → 501 Not Implemented', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/course_1`)
    expect(res.status).toBe(501)
  })

  it('GET /api/courses/:id/lessons → 501 Not Implemented', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/course_1/lessons`)
    expect(res.status).toBe(501)
  })

  it('returns 405 for an unsupported method on /api/courses', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses`, { method: 'DELETE' })
    expect(res.status).toBe(405)
  })

  it('does NOT clobber the existing /api/lessons route (still 200 list)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/lessons`)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// WAT-10 — GET /api/courses/lessons
// ---------------------------------------------------------------------------
describe('WAT-10 — GET /api/courses/lessons', () => {
  const now = new Date().toISOString()

  async function insertLesson(id: string, createdAt: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO lessons
         (id, presentation_id, title, description, slides, status,
          created_at, updated_at, published_at,
          owner_id, source_presentation_id, estimated_duration_minutes, language)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?)`,
    )
      .bind(id, 42, `Lesson ${id}`, '', '[]', createdAt, createdAt, 42, 5, 'en')
      .run()
  }

  async function insertSlide(id: string, lessonId: string, order: number): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, lessonId, order, 'question', JSON.stringify({ q: 'test?' }))
      .run()
  }

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM lesson_slides')
    await env.DB.exec('DELETE FROM lessons')
  })

  it('returns 200 with an empty array when no normalized lessons exist', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lessons: unknown[] }
    expect(Array.isArray(body.lessons)).toBe(true)
    expect(body.lessons.length).toBe(0)
  })

  it('excludes legacy JSON-blob lessons that have no lesson_slides', async () => {
    // Insert a legacy lesson (no lesson_slides)
    await insertLesson('legacy_1', now)

    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lessons: unknown[] }
    // Legacy lesson has no lesson_slides — should be excluded
    expect(body.lessons.length).toBe(0)
  })

  it('returns normalized lessons that have lesson_slides, newest created_at first', async () => {
    const t1 = '2026-06-01T08:00:00.000Z'
    const t2 = '2026-06-01T09:00:00.000Z'
    await insertLesson('lesson_older', t1)
    await insertLesson('lesson_newer', t2)
    await insertSlide('slide_a', 'lesson_older', 0)
    await insertSlide('slide_b', 'lesson_newer', 0)
    await insertSlide('slide_c', 'lesson_newer', 1)

    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lessons: Array<{ id: string; slideCount: number }> }
    expect(body.lessons.length).toBe(2)
    // Newest first
    expect(body.lessons[0].id).toBe('lesson_newer')
    expect(body.lessons[1].id).toBe('lesson_older')
    // Correct slide counts
    expect(body.lessons[0].slideCount).toBe(2)
    expect(body.lessons[1].slideCount).toBe(1)
  })

  it('response includes expected normalized lesson fields', async () => {
    await insertLesson('lesson_z', now)
    await insertSlide('slide_z', 'lesson_z', 0)

    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons`)
    const body = (await res.json()) as { lessons: Array<Record<string, unknown>> }
    const l = body.lessons[0]
    expect(l.id).toBe('lesson_z')
    expect(l.title).toBe('Lesson lesson_z')
    expect(l.status).toBe('draft')
    expect(typeof l.createdAt).toBe('string')
    expect(l.sourcePresentationId).toBe(42)
    expect(l.estimatedDurationMinutes).toBe(5)
    expect(l.language).toBe('en')
    expect(l.slideCount).toBe(1)
  })

  it('returns 405 for non-GET on /api/courses/lessons', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('does not confuse /api/courses/lessons with /api/courses/:id routes', async () => {
    // Exact path /api/courses/lessons hits our live route → 200
    const lessonsRes = await SELF.fetch(`${ORIGIN}/api/courses/lessons`)
    expect(lessonsRes.status).toBe(200)

    // A different id (not "lessons") hits the WAT-8 stub → 501
    const stubRes = await SELF.fetch(`${ORIGIN}/api/courses/some_other_id`)
    expect(stubRes.status).toBe(501)
  })
})
