/**
 * CF Worker integration tests for the lessons API (WAT-3) — run INSIDE workerd
 * (via Miniflare) with the REAL D1 binding (`env.DB`) from wrangler.jsonc.
 *
 * Covers: PUT upsert (create + update), GET one + list, the publish route, and
 * DELETE — plus the 404/405 error paths. The migrations (incl. 0002_lessons)
 * are applied per file via applyD1Migrations so the schema matches production.
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
const lessonUrl = (id: string) => `${ORIGIN}/api/lessons/${encodeURIComponent(id)}`

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM lessons')
})

function sampleLesson(over: Record<string, unknown> = {}) {
  return {
    id: 'lesson_1',
    presentationId: 42,
    title: 'Onboarding',
    description: 'Welcome',
    slides: [
      { id: 1, type: 'text', heading: 'Hi', body: 'Welcome aboard' },
      { id: 2, type: 'pickAnswer', question: 'OK?', options: [{ id: 1, text: 'Yes', isCorrect: true }] },
    ],
    ...over,
  }
}

async function put(id: string, body: unknown): Promise<Response> {
  return SELF.fetch(lessonUrl(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/lessons/:id (upsert)', () => {
  it('creates a draft lesson and returns it with full fields', async () => {
    const res = await put('lesson_1', sampleLesson())
    expect(res.status).toBe(200)
    const { lesson } = (await res.json()) as { lesson: Record<string, unknown> }
    expect(lesson.id).toBe('lesson_1')
    expect(lesson.title).toBe('Onboarding')
    expect(lesson.description).toBe('Welcome')
    expect(lesson.status).toBe('draft')
    expect(lesson.publishedAt).toBeNull()
    expect(Array.isArray(lesson.slides)).toBe(true)
    expect((lesson.slides as unknown[]).length).toBe(2)
    expect(typeof lesson.createdAt).toBe('string')
    expect(typeof lesson.updatedAt).toBe('string')
  })

  it('updates an existing lesson and preserves status/createdAt', async () => {
    const created = await (await put('lesson_1', sampleLesson())).json() as { lesson: { createdAt: string } }
    const res = await put('lesson_1', sampleLesson({ title: 'Renamed', slides: [] }))
    const { lesson } = (await res.json()) as { lesson: Record<string, unknown> }
    expect(lesson.title).toBe('Renamed')
    expect((lesson.slides as unknown[]).length).toBe(0)
    expect(lesson.status).toBe('draft')
    expect(lesson.createdAt).toBe(created.lesson.createdAt)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await SELF.fetch(lessonUrl('lesson_x'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/lessons (+ :id)', () => {
  it('returns one lesson, or 404 for unknown id', async () => {
    await put('lesson_1', sampleLesson())
    const ok = await SELF.fetch(lessonUrl('lesson_1'))
    expect(ok.status).toBe(200)
    const missing = await SELF.fetch(lessonUrl('nope'))
    expect(missing.status).toBe(404)
  })

  it('lists lessons newest-updated first', async () => {
    await put('lesson_a', sampleLesson({ id: 'lesson_a', title: 'A' }))
    await new Promise((r) => setTimeout(r, 5))
    await put('lesson_b', sampleLesson({ id: 'lesson_b', title: 'B' }))

    const res = await SELF.fetch(`${ORIGIN}/api/lessons`)
    expect(res.status).toBe(200)
    const { lessons } = (await res.json()) as { lessons: { title: string }[] }
    expect(lessons.length).toBe(2)
    expect(lessons[0].title).toBe('B')
    expect(lessons[1].title).toBe('A')
  })
})

describe('POST /api/lessons/:id/publish', () => {
  it('flips status to published and sets publishedAt', async () => {
    await put('lesson_1', sampleLesson())
    const res = await SELF.fetch(`${lessonUrl('lesson_1')}/publish`, { method: 'POST' })
    expect(res.status).toBe(200)
    const { lesson } = (await res.json()) as { lesson: Record<string, unknown> }
    expect(lesson.status).toBe('published')
    expect(typeof lesson.publishedAt).toBe('string')
  })

  it('returns 404 publishing a lesson that does not exist', async () => {
    const res = await SELF.fetch(`${lessonUrl('ghost')}/publish`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 405 for a non-POST on the publish route', async () => {
    const res = await SELF.fetch(`${lessonUrl('lesson_1')}/publish`, { method: 'GET' })
    expect(res.status).toBe(405)
  })
})

describe('DELETE /api/lessons/:id', () => {
  it('deletes a lesson', async () => {
    await put('lesson_1', sampleLesson())
    const del = await SELF.fetch(lessonUrl('lesson_1'), { method: 'DELETE' })
    expect(del.status).toBe(200)
    const after = await SELF.fetch(lessonUrl('lesson_1'))
    expect(after.status).toBe(404)
  })
})

describe('lessons route — method handling', () => {
  it('returns 405 for an unsupported method on the collection', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/lessons`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
