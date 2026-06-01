/**
 * WAT-13 (Stage 5) — CF Worker integration tests for the PUBLIC learner
 * persistence endpoints + the learn resolver fields used by the player.
 *
 * Runs INSIDE workerd (Miniflare) with the REAL D1 binding (`env.DB`).
 *
 * Covers:
 *   - GET  /api/learn/:slug now returns description + estimatedDurationMinutes
 *   - POST /api/learn/:slug/start    create-or-resume a learner; 404 not-available
 *   - POST /api/learn/:slug/progress upsert current slide / completion; resumes
 *   - POST /api/learn/:slug/response records an answer keyed by slide order
 *   - the three endpoints 404 for unknown/unpublished slugs
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
  await env.DB.exec('DELETE FROM lessons')
})

function api(path: string, method = 'GET', body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/** Insert a PUBLISHED lesson with a slug + a 2-question snapshot. */
async function publishedLesson(
  opts: { slug: string; authMode?: string; description?: string; durationMin?: number } = {
    slug: 's1',
  },
): Promise<string> {
  const id = `l_${opts.slug}`
  const now = new Date().toISOString()
  const snapshot = JSON.stringify([
    { order: 0, type: 'question', content: { question: 'Q1?', options: ['a', 'b', 'c', 'd'], correct_index: 0 } },
    { order: 1, type: 'explanation', content: { explanation: 'E1.' } },
    { order: 2, type: 'question', content: { question: 'Q2?', options: ['a', 'b', 'c', 'd'], correct_index: 2 } },
    { order: 3, type: 'explanation', content: { explanation: 'E2.' } },
  ])
  await env.DB.prepare(
    `INSERT INTO lessons
       (id, presentation_id, title, description, slides, status,
        created_at, updated_at, published_at,
        source_presentation_id, estimated_duration_minutes, language, reviewed,
        share_link_slug, auth_mode, published_title, published_slides_json)
     VALUES (?, 42, ?, ?, '[]', 'published', ?, ?, ?, 42, ?, 'en', 1, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      'Discover Hanoi',
      opts.description ?? 'A short lesson.',
      now,
      now,
      now,
      opts.durationMin ?? 5,
      opts.slug,
      opts.authMode ?? 'name',
      'Discover Hanoi',
      snapshot,
    )
    .run()
  return id
}

// ── Resolver fields ─────────────────────────────────────────────────────────
describe('GET /api/learn/:slug (player fields)', () => {
  it('returns description + estimatedDurationMinutes for the landing', async () => {
    await publishedLesson({ slug: 's1', description: 'Hanoi intro', durationMin: 7 })
    const res = await api('/api/learn/s1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.available).toBe(true)
    expect(body.lesson.description).toBe('Hanoi intro')
    expect(body.lesson.estimatedDurationMinutes).toBe(7)
    expect(body.lesson.slides).toHaveLength(4)
  })
})

// ── start ─────────────────────────────────────────────────────────────────
describe('POST /api/learn/:slug/start', () => {
  it('404s for an unknown slug', async () => {
    const res = await api('/api/learn/nope/start', 'POST', { identifier: 'Sam' })
    expect(res.status).toBe(404)
  })

  it('creates a learner and returns a fresh resume position', async () => {
    await publishedLesson({ slug: 's1', authMode: 'name' })
    const res = await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.learnerId).toBeTruthy()
    expect(body.currentSlideOrder).toBe(0)
    expect(body.completedAt).toBeNull()
  })

  it('RESUMES the same learner (same id + saved progress) on a repeat identifier', async () => {
    await publishedLesson({ slug: 's1', authMode: 'name' })
    const first = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    await api('/api/learn/s1/progress', 'POST', { learnerId: first.learnerId, currentSlideOrder: 2 })
    const second = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    expect(second.learnerId).toBe(first.learnerId)
    expect(second.currentSlideOrder).toBe(2)
  })

  it('different identifiers get different learners', async () => {
    await publishedLesson({ slug: 's1', authMode: 'email' })
    const a = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'a@x.com' })).json()) as any
    const b = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'b@x.com' })).json()) as any
    expect(a.learnerId).not.toBe(b.learnerId)
  })
})

// ── progress ────────────────────────────────────────────────────────────────
describe('POST /api/learn/:slug/progress', () => {
  it('upserts current slide and marks completion', async () => {
    await publishedLesson({ slug: 's1' })
    const { learnerId } = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    await api('/api/learn/s1/progress', 'POST', { learnerId, currentSlideOrder: 3 })
    let resume = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    expect(resume.currentSlideOrder).toBe(3)
    expect(resume.completedAt).toBeNull()

    await api('/api/learn/s1/progress', 'POST', { learnerId, currentSlideOrder: 4, completed: true })
    resume = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    expect(resume.currentSlideOrder).toBe(4)
    expect(resume.completedAt).toBeTruthy()
  })

  it('400s without a learnerId', async () => {
    await publishedLesson({ slug: 's1' })
    const res = await api('/api/learn/s1/progress', 'POST', { currentSlideOrder: 1 })
    expect(res.status).toBe(400)
  })

  it('404s for an unpublished slug', async () => {
    const res = await api('/api/learn/missing/progress', 'POST', { learnerId: 'x', currentSlideOrder: 1 })
    expect(res.status).toBe(404)
  })
})

// ── response ─────────────────────────────────────────────────────────────────
describe('POST /api/learn/:slug/response', () => {
  it('records an answer keyed by slide order', async () => {
    await publishedLesson({ slug: 's1' })
    const { learnerId } = (await (await api('/api/learn/s1/start', 'POST', { identifier: 'Sam' })).json()) as any
    const res = await api('/api/learn/s1/response', 'POST', {
      learnerId,
      slideOrder: 0,
      value: { selected: 1, correct: false },
    })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare(
      `SELECT lesson_slide_id, response_value FROM learner_responses WHERE learner_id = ?`,
    )
      .bind(learnerId)
      .first<{ lesson_slide_id: string; response_value: string }>()
    expect(row?.lesson_slide_id).toBe('0')
    expect(JSON.parse(row!.response_value)).toEqual({ selected: 1, correct: false })
  })

  it('400s without a learnerId', async () => {
    await publishedLesson({ slug: 's1' })
    const res = await api('/api/learn/s1/response', 'POST', { slideOrder: 0, value: {} })
    expect(res.status).toBe(400)
  })

  it('404s for an unknown slug', async () => {
    const res = await api('/api/learn/nope/response', 'POST', { learnerId: 'x', slideOrder: 0, value: {} })
    expect(res.status).toBe(404)
  })
})
