/**
 * CF Worker integration tests for the attempts API (WAT-5) — run INSIDE the
 * Workers runtime (workerd, via Miniflare) using @cloudflare/vitest-pool-workers
 * with the REAL D1 binding (`env.DB`) wired from wrangler.jsonc.
 *
 * The pool gives each test file an isolated D1 instance. We apply the project's
 * migration(s) once in beforeAll via `applyD1Migrations` so the schema matches
 * production exactly, then clear the table between tests for isolation.
 *
 * Covers: POST inserts an attempt, multiple attempts per lesson are all kept
 * (no dedupe), GET returns them newest-first, scoping by lessonId, and the
 * 400/404/405 error paths.
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

function attemptsUrl(lessonId: string): string {
  return `${ORIGIN}/api/lessons/${encodeURIComponent(lessonId)}/attempts`
}

beforeAll(async () => {
  // Apply the project's migrations into this file's isolated D1 instance.
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM attempts')
})

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    audienceName: 'Ada',
    score: 1,
    total: 2,
    responses: [
      {
        slideId: 1,
        type: 'pickAnswer',
        question: 'Capital of France?',
        response: { optionId: 11, text: 'Paris' },
        correct: true,
      },
      {
        slideId: 2,
        type: 'pickAnswer',
        question: 'Capital of Japan?',
        response: { optionId: 21, text: 'Seoul' },
        correct: false,
      },
    ],
    ...overrides,
  }
}

async function post(lessonId: string, body: unknown): Promise<Response> {
  return SELF.fetch(attemptsUrl(lessonId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/lessons/:lessonId/attempts', () => {
  it('inserts an attempt and returns it with a server-assigned id + createdAt', async () => {
    const res = await post('lesson_a', samplePayload())
    expect(res.status).toBe(201)

    const body = (await res.json()) as { attempt: Record<string, unknown> }
    const a = body.attempt
    expect(a.lessonId).toBe('lesson_a')
    expect(a.audienceName).toBe('Ada')
    expect(a.score).toBe(1)
    expect(a.total).toBe(2)
    expect(typeof a.id).toBe('string')
    expect((a.id as string).length).toBeGreaterThan(0)
    expect(typeof a.createdAt).toBe('string')
    expect(Array.isArray(a.responses)).toBe(true)
    expect((a.responses as unknown[]).length).toBe(2)
  })

  it('allows MULTIPLE attempts per lesson (every POST is a new row)', async () => {
    await post('lesson_b', samplePayload({ audienceName: 'A' }))
    await post('lesson_b', samplePayload({ audienceName: 'B' }))
    await post('lesson_b', samplePayload({ audienceName: 'C' }))

    const res = await SELF.fetch(attemptsUrl('lesson_b'))
    const body = (await res.json()) as { attempts: unknown[] }
    expect(body.attempts.length).toBe(3)
  })

  it('treats an empty/whitespace audienceName as null (anonymous)', async () => {
    const res = await post('lesson_c', samplePayload({ audienceName: '   ' }))
    const body = (await res.json()) as { attempt: { audienceName: unknown } }
    expect(body.attempt.audienceName).toBeNull()
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await SELF.fetch(attemptsUrl('lesson_x'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 405 for unsupported methods', async () => {
    const res = await SELF.fetch(attemptsUrl('lesson_x'), { method: 'DELETE' })
    expect(res.status).toBe(405)
  })
})

describe('GET /api/lessons/:lessonId/attempts', () => {
  it('returns attempts newest-first and parses the responses snapshot', async () => {
    await post('lesson_d', samplePayload({ audienceName: 'first' }))
    // Ensure a distinct, later createdAt for ordering.
    await new Promise((r) => setTimeout(r, 5))
    await post('lesson_d', samplePayload({ audienceName: 'second' }))

    const res = await SELF.fetch(attemptsUrl('lesson_d'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      attempts: { audienceName: string; responses: unknown[] }[]
    }
    expect(body.attempts.length).toBe(2)
    expect(body.attempts[0].audienceName).toBe('second')
    expect(body.attempts[1].audienceName).toBe('first')
    expect(body.attempts[0].responses.length).toBe(2)
  })

  it('scopes attempts to the requested lesson only', async () => {
    await post('lesson_e', samplePayload())
    await post('lesson_f', samplePayload())

    const res = await SELF.fetch(attemptsUrl('lesson_e'))
    const body = (await res.json()) as { attempts: { lessonId: string }[] }
    expect(body.attempts.length).toBe(1)
    expect(body.attempts[0].lessonId).toBe('lesson_e')
  })

  it('returns an empty array for a lesson with no attempts', async () => {
    const res = await SELF.fetch(attemptsUrl('lesson_none'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { attempts: unknown[] }
    expect(body.attempts).toEqual([])
  })
})

describe('unknown /api routes', () => {
  it('returns 404 JSON for an unmatched /api path', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/nope`)
    expect(res.status).toBe(404)
  })
})
