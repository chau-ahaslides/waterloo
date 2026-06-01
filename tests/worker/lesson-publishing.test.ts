/**
 * WAT-12 — CF Worker integration tests for lesson publishing.
 * Runs INSIDE workerd (Miniflare) with the REAL D1 binding (`env.DB`).
 *
 * Covers:
 *   - publish requires reviewed=true (409 otherwise)
 *   - publish generates a unique slug; the slug is STABLE across republish
 *   - auth_mode persistence (set-before-publish + on publish)
 *   - update-published promotes the draft snapshot, keeps the slug
 *   - draft edits create an "unpublished draft" (hasDraftChanges) without
 *     changing the LIVE published version served by slug
 *   - unpublish → public /api/learn/:slug shows not-available; re-publish reuses slug
 *   - learner progress is PRESERVED across republish
 *   - GET /api/learn/:slug not-available for unknown/draft/unpublished slugs
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

// ── Fixtures ──────────────────────────────────────────────────────────────

async function insertLesson(id: string, opts: { reviewed?: boolean } = {}): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO lessons
       (id, presentation_id, title, description, slides, status,
        created_at, updated_at, published_at,
        owner_id, source_presentation_id, estimated_duration_minutes, language, reviewed)
     VALUES (?, 42, ?, '', '[]', 'draft', ?, ?, NULL, NULL, 42, 5, 'en', ?)`,
  )
    .bind(id, `Title ${id}`, now, now, opts.reviewed ? 1 : 0)
    .run()
}

async function seedPairs(lessonId: string, n: number): Promise<void> {
  let order = 0
  for (let i = 0; i < n; i++) {
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'question', ?)`,
    )
      .bind(`q_${lessonId}_${i}`, lessonId, order++, JSON.stringify({ question: `Q${i}?`, options: ['a', 'b', 'c', 'd'], correct_index: 0 }))
      .run()
    await env.DB.prepare(
      `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'explanation', ?)`,
    )
      .bind(`e_${lessonId}_${i}`, lessonId, order++, JSON.stringify({ explanation: `E${i}.` }))
      .run()
  }
}

function api(path: string, method = 'GET', body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ── Publish gating ──────────────────────────────────────────────────────────

describe('POST /api/courses/lessons/:id/publish', () => {
  it('409s when the lesson is not reviewed', async () => {
    await insertLesson('l1', { reviewed: false })
    await seedPairs('l1', 3)
    const res = await api('/api/courses/lessons/l1/publish', 'POST', {})
    expect(res.status).toBe(409)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/reviewed/i)
  })

  it('publishes a reviewed lesson, generating a slug + default name auth mode', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const res = await api('/api/courses/lessons/l1/publish', 'POST', {})
    expect(res.status).toBe(200)
    const { publishState } = (await res.json()) as any
    expect(publishState.status).toBe('published')
    expect(publishState.shareLinkSlug).toBeTruthy()
    expect(publishState.authMode).toBe('name')
    expect(publishState.hasDraftChanges).toBe(false)
  })

  it('persists a supplied auth mode on publish', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const res = await api('/api/courses/lessons/l1/publish', 'POST', { authMode: 'email' })
    const { publishState } = (await res.json()) as any
    expect(publishState.authMode).toBe('email')
  })

  it('keeps the SAME slug across republish (unpublish → publish)', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const first = (await (await api('/api/courses/lessons/l1/publish', 'POST', {})).json()) as any
    const slug = first.publishState.shareLinkSlug
    await api('/api/courses/lessons/l1/unpublish', 'POST')
    const second = (await (await api('/api/courses/lessons/l1/publish', 'POST', {})).json()) as any
    expect(second.publishState.shareLinkSlug).toBe(slug)
  })

  it('generates DISTINCT slugs for different lessons', async () => {
    await insertLesson('l1', { reviewed: true })
    await insertLesson('l2', { reviewed: true })
    await seedPairs('l1', 3)
    await seedPairs('l2', 3)
    const a = (await (await api('/api/courses/lessons/l1/publish', 'POST', {})).json()) as any
    const b = (await (await api('/api/courses/lessons/l2/publish', 'POST', {})).json()) as any
    expect(a.publishState.shareLinkSlug).not.toBe(b.publishState.shareLinkSlug)
  })
})

// ── Auth mode (pre-publish) ───────────────────────────────────────────────────

describe('PUT /api/courses/lessons/:id/auth-mode', () => {
  it('sets the auth mode before publishing', async () => {
    await insertLesson('l1', { reviewed: true })
    const res = await api('/api/courses/lessons/l1/auth-mode', 'PUT', { authMode: 'anonymous' })
    expect(res.status).toBe(200)
    const { publishState } = (await res.json()) as any
    expect(publishState.authMode).toBe('anonymous')
  })

  it('400s on an invalid auth mode', async () => {
    await insertLesson('l1', { reviewed: true })
    const res = await api('/api/courses/lessons/l1/auth-mode', 'PUT', { authMode: 'sms' })
    expect(res.status).toBe(400)
  })
})

// ── Draft-vs-live + update-published ─────────────────────────────────────────

describe('update-published promotes the draft', () => {
  it('edits create an unpublished draft; the LIVE version is unchanged until promoted', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const pub = (await (await api('/api/courses/lessons/l1/publish', 'POST', {})).json()) as any
    const slug = pub.publishState.shareLinkSlug

    // Edit the draft (changes a question title).
    await api('/api/courses/lessons/l1', 'PATCH', {
      slides: [{ id: 'q_l1_0', content: { question: 'EDITED?', options: ['a', 'b', 'c', 'd'], correct_index: 1 } }],
    })

    // The publish state now flags an unpublished draft…
    const state = (await (await api('/api/courses/lessons/l1/publish-state')).json()) as any
    expect(state.publishState.hasDraftChanges).toBe(true)

    // …but the LIVE published snapshot served by slug is still the original.
    const live = (await (await api(`/api/learn/${slug}`)).json()) as any
    const liveQ0 = live.lesson.slides.find((s: any) => s.type === 'question')
    expect(liveQ0.content.question).toBe('Q0?')

    // Promote → live now reflects the edit; slug unchanged; hasDraftChanges clears.
    const promoted = (await (await api('/api/courses/lessons/l1/update-published', 'POST')).json()) as any
    expect(promoted.publishState.shareLinkSlug).toBe(slug)
    expect(promoted.publishState.hasDraftChanges).toBe(false)
    const live2 = (await (await api(`/api/learn/${slug}`)).json()) as any
    const live2Q0 = live2.lesson.slides.find((s: any) => s.type === 'question')
    expect(live2Q0.content.question).toBe('EDITED?')
  })

  it('409s update-published when the lesson was never published', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const res = await api('/api/courses/lessons/l1/update-published', 'POST')
    expect(res.status).toBe(409)
  })
})

// ── Unpublish + public resolve ────────────────────────────────────────────────

describe('unpublish + GET /api/learn/:slug', () => {
  it('unpublish takes the lesson offline (slug → not-available)', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    const pub = (await (await api('/api/courses/lessons/l1/publish', 'POST', {})).json()) as any
    const slug = pub.publishState.shareLinkSlug

    const liveBefore = await api(`/api/learn/${slug}`)
    expect(liveBefore.status).toBe(200)
    expect(((await liveBefore.json()) as any).available).toBe(true)

    await api('/api/courses/lessons/l1/unpublish', 'POST')
    const liveAfter = await api(`/api/learn/${slug}`)
    expect(liveAfter.status).toBe(404)
    const body = (await liveAfter.json()) as any
    expect(body.available).toBe(false)
    expect(body.error).toMatch(/not available/i)
  })

  it('404/not-available for an unknown slug', async () => {
    const res = await api('/api/learn/doesnotexist')
    expect(res.status).toBe(404)
    expect(((await res.json()) as any).available).toBe(false)
  })

  it('not-available for a draft (never published) lesson even if it had a slug column', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    // Never published → no slug at all → unknown.
    const res = await api('/api/learn/whatever')
    expect(res.status).toBe(404)
  })
})

// ── Learner progress preserved across republish ──────────────────────────────

describe('learner progress preserved across republish', () => {
  it('keeps learners / progress / responses through unpublish + update-published', async () => {
    await insertLesson('l1', { reviewed: true })
    await seedPairs('l1', 3)
    await api('/api/courses/lessons/l1/publish', 'POST', {})

    // Simulate an existing learner with progress + a response, keyed to the lesson.
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO learners (id, course_id, identifier, created_at) VALUES ('lr1', 'c1', 'Ada', ?)`,
    ).bind(now).run()
    await env.DB.prepare(
      `INSERT INTO learner_progress (id, learner_id, lesson_id, current_slide_order, completed_at)
       VALUES ('lp1', 'lr1', 'l1', 2, NULL)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO learner_responses (id, learner_id, lesson_slide_id, response_value, created_at)
       VALUES ('lrs1', 'lr1', 'q_l1_0', '1', ?)`,
    ).bind(now).run()

    // Republish lifecycle: edit → update-published → unpublish → re-publish.
    await api('/api/courses/lessons/l1', 'PATCH', {
      slides: [{ id: 'q_l1_0', content: { question: 'new?', options: ['a', 'b', 'c', 'd'], correct_index: 0 } }],
    })
    await api('/api/courses/lessons/l1/update-published', 'POST')
    await api('/api/courses/lessons/l1/unpublish', 'POST')
    await api('/api/courses/lessons/l1/publish', 'POST', {})

    const learners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM learners`).first<{ n: number }>()
    const progress = await env.DB.prepare(`SELECT current_slide_order AS o FROM learner_progress WHERE id = 'lp1'`).first<{ o: number }>()
    const responses = await env.DB.prepare(`SELECT COUNT(*) AS n FROM learner_responses`).first<{ n: number }>()
    expect(learners?.n).toBe(1)
    expect(progress?.o).toBe(2)
    expect(responses?.n).toBe(1)
  })
})

// ── Method guards ─────────────────────────────────────────────────────────────

describe('method guards', () => {
  it('405s GET on publish', async () => {
    await insertLesson('l1', { reviewed: true })
    const res = await api('/api/courses/lessons/l1/publish')
    expect(res.status).toBe(405)
  })

  it('404s publish-state for an unknown lesson', async () => {
    const res = await api('/api/courses/lessons/nope/publish-state')
    expect(res.status).toBe(404)
  })
})
