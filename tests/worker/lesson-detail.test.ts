/**
 * WAT-11 — CF Worker integration tests for the lesson detail / editor API.
 * Runs INSIDE workerd (Miniflare) with the REAL D1 binding (`env.DB`). The AI /
 * presenter network are NOT exercised here (regenerate-one / regenerate-all
 * unit-level logic lives in lessons-convert; here we test the route plumbing,
 * the validation/errors that don't need AI, and the DB-only operations:
 * save / reorder / delete(min-3) / reviewed-flag).
 *
 * Covers:
 *   - GET /api/courses/lessons/:id          → lesson + ordered slides (or 404)
 *   - PATCH …/:id                           → save title / duration / slide content
 *   - POST …/:id/reorder                    → reorder Q+E pairs, E follows Q
 *   - DELETE …/:id/questions/:order         → delete pair + renumber; min-3 → 409
 *   - POST …/:id/reviewed                   → reviewed flag set
 *   - regenerate routes wired (405 for wrong method; 422 with no source)
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
  await env.DB.exec('DELETE FROM lesson_slides')
  await env.DB.exec('DELETE FROM lessons')
})

// ── Fixtures ──────────────────────────────────────────────────────────────

async function insertLesson(
  id: string,
  opts: { sourcePresentationId?: number | null } = {},
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO lessons
       (id, presentation_id, title, description, slides, status,
        created_at, updated_at, published_at,
        owner_id, source_presentation_id, estimated_duration_minutes, language, reviewed)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?, 0)`,
  )
    .bind(
      id,
      42,
      `Title ${id}`,
      '',
      '[]',
      now,
      now,
      opts.sourcePresentationId === undefined ? 42 : opts.sourcePresentationId,
      5,
      'en',
    )
    .run()
}

/** Seed `n` interleaved Q,E pairs. Returns the question slide ids in order. */
async function seedPairs(lessonId: string, n: number): Promise<string[]> {
  const qIds: string[] = []
  let order = 0
  for (let i = 0; i < n; i++) {
    const qId = `q_${lessonId}_${i}`
    const eId = `e_${lessonId}_${i}`
    qIds.push(qId)
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'question', ?)`,
    )
      .bind(qId, lessonId, order++, JSON.stringify({ question: `Q${i}?`, options: ['a', 'b', 'c', 'd'], correct_index: 0 }))
      .run()
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'explanation', ?)`,
    )
      .bind(eId, lessonId, order++, JSON.stringify({ explanation: `E${i}.` }))
      .run()
  }
  return qIds
}

async function getDetail(id: string) {
  const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/${id}`)
  return { res, body: (await res.json()) as any }
}

// ── GET detail ────────────────────────────────────────────────────────────

describe('GET /api/courses/lessons/:id', () => {
  it('404s for an unknown lesson', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/nope`)
    expect(res.status).toBe(404)
  })

  it('returns the lesson + slides in order', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 4)
    const { res, body } = await getDetail('l1')
    expect(res.status).toBe(200)
    expect(body.lesson.id).toBe('l1')
    expect(body.lesson.reviewed).toBe(false)
    expect(body.slides).toHaveLength(8)
    expect(body.slides[0].type).toBe('question')
    expect(body.slides[1].type).toBe('explanation')
    expect(body.slides.map((s: any) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

// ── PATCH save ──────────────────────────────────────────────────────────────

describe('PATCH /api/courses/lessons/:id', () => {
  it('saves title + duration', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New title', estimatedDurationMinutes: 12 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.lesson.title).toBe('New title')
    expect(body.lesson.estimatedDurationMinutes).toBe(12)
  })

  it('updates a slide content blob in place', async () => {
    await insertLesson('l1')
    const qIds = await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slides: [
          { id: qIds[0], content: { question: 'Edited?', options: ['w', 'x', 'y', 'z'], correct_index: 2 } },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const { body } = await getDetail('l1')
    const q0 = body.slides.find((s: any) => s.id === qIds[0])
    expect(q0.content.question).toBe('Edited?')
    expect(q0.content.correct_index).toBe(2)
  })

  it('ignores slide ids not belonging to the lesson', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slides: [{ id: 'foreign', content: { question: 'x' } }] }),
    })
    expect(res.status).toBe(200) // no throw, foreign id simply skipped
  })
})

// ── Reorder ───────────────────────────────────────────────────────────────

describe('POST /api/courses/lessons/:id/reorder', () => {
  it('reorders pairs keeping each E immediately after its Q', async () => {
    await insertLesson('l1')
    const qIds = await seedPairs('l1', 3) // [q0,q1,q2]
    // New order: q2, q0, q1
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: [qIds[2], qIds[0], qIds[1]] }),
    })
    expect(res.status).toBe(200)
    const { body } = await getDetail('l1')
    // Questions should now appear q2, q0, q1, each followed by its E.
    const qOrder = body.slides.filter((s: any) => s.type === 'question').map((s: any) => s.id)
    expect(qOrder).toEqual([qIds[2], qIds[0], qIds[1]])
    // E follows its own Q (positional pairing preserved).
    for (let i = 0; i < body.slides.length; i += 2) {
      expect(body.slides[i].type).toBe('question')
      expect(body.slides[i + 1].type).toBe('explanation')
    }
    // Orders are contiguous 0..5
    expect(body.slides.map((s: any) => s.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('400s when order is not a permutation of the question ids', async () => {
    await insertLesson('l1')
    const qIds = await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: [qIds[0], qIds[1]] }), // missing one
    })
    expect(res.status).toBe(400)
  })
})

// ── Delete (min 3) ──────────────────────────────────────────────────────────

describe('DELETE /api/courses/lessons/:id/questions/:order', () => {
  it('deletes a Q+E pair and renumbers', async () => {
    await insertLesson('l1')
    const qIds = await seedPairs('l1', 4) // 8 slides
    // Delete the question at order 2 (the second question, q1).
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/questions/2`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const { body } = await getDetail('l1')
    expect(body.slides).toHaveLength(6)
    const qOrder = body.slides.filter((s: any) => s.type === 'question').map((s: any) => s.id)
    expect(qOrder).toEqual([qIds[0], qIds[2], qIds[3]])
    expect(body.slides.map((s: any) => s.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('blocks deleting below the min of 3 (409)', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/questions/0`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/at least 3/)
    // Nothing deleted.
    const { body: detail } = await getDetail('l1')
    expect(detail.slides).toHaveLength(6)
  })

  it('404s when no question exists at that order', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 4)
    // order 1 is an explanation, not a question.
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/questions/1`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

// ── Reviewed flag ────────────────────────────────────────────────────────────

describe('POST /api/courses/lessons/:id/reviewed', () => {
  it('sets reviewed=true', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const before = await getDetail('l1')
    expect(before.body.lesson.reviewed).toBe(false)

    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/reviewed`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.lesson.reviewed).toBe(true)

    const after = await getDetail('l1')
    expect(after.body.lesson.reviewed).toBe(true)
  })

  it('404s for an unknown lesson', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/missing/reviewed`, {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })
})

// ── Regenerate route plumbing (no AI needed for these branches) ──────────────

describe('regenerate routes', () => {
  it('405s on GET to regenerate-all', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/regenerate`)
    expect(res.status).toBe(405)
  })

  it('422s regenerate-all when the lesson has no source presentation', async () => {
    await insertLesson('l1', { sourcePresentationId: null })
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(422)
  })

  it('422s regenerate-one when the lesson has no source presentation', async () => {
    await insertLesson('l1', { sourcePresentationId: null })
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/questions/0/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(422)
  })

  it('404s regenerate-one when no question exists at that order', async () => {
    await insertLesson('l1')
    await seedPairs('l1', 3)
    const res = await SELF.fetch(`${ORIGIN}/api/courses/lessons/l1/questions/99/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})
