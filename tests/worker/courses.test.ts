/**
 * CF Worker integration tests for the Courses-feature foundation (WAT-8) — run
 * INSIDE workerd (via Miniflare) with the REAL D1 binding (`env.DB`) from
 * wrangler.jsonc. The migrations (incl. 0003_courses_foundation) are applied
 * per file via applyD1Migrations so the schema matches production.
 *
 * STAGE 1 is models + route scaffolding only, so these tests assert:
 *   1. The 7 Courses-feature tables exist after migration.
 *   2. The new nullable columns were added to the existing `lessons` table.
 *   3. Basic insert/select round-trips on a couple of the new tables.
 *   4. The /api/courses stub routes respond (501 + 405 where expected) without
 *      touching the existing /api/lessons routes.
 */

import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { beforeAll, describe, it, expect } from 'vitest'

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
