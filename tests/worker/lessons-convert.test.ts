/**
 * CF Worker integration tests for the WAT-9 conversion engine — run INSIDE
 * workerd (via Miniflare) with the REAL D1 binding (`env.DB`). The presenter
 * fetch and the AI call are MOCKED (injected callbacks) for determinism — no
 * network, no AI spend.
 *
 * Asserts the WAT-9 contract:
 *   - A 10-question result saves 20 lesson_slides interleaved Q1,E1,…,Q10,E10
 *     in correct order, plus one lessons row in the normalized model.
 *   - <3 content slides → 422 error (no rows written).
 *   - <10 supportable questions → as-many-as-possible (min 3) + a warning.
 *   - Output language is carried from the source deck onto the lessons row.
 *   - Validation: exactly 4 options / exactly 1 correct enforced; malformed
 *     questions are dropped/repaired.
 *   - Route-level: POST /api/lessons/convert wiring (400 missing id, 405).
 */

import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, it, expect } from 'vitest'
import {
  buildAndSaveLesson,
  extractContentSlides,
  parseAiQuestions,
  regenerateLessonAll,
  regenerateOneQuestion,
  validateQuestion,
  type ConvertDeps,
  type GeneratedQuestion,
  type PresentationDetail,
} from '../../worker/lessons-convert'

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

function contentSlide(order: number, title: string) {
  return { order, title, bodyHTML: `Body for ${title}`, notes: '', SlideOptions: [] }
}

function deck(slides: unknown[], language = 'en', name = 'Test Deck'): PresentationDetail {
  return { name, language, Slides: slides as never }
}

function mkQuestion(i: number): GeneratedQuestion {
  return {
    question: `Question ${i}?`,
    options: [`opt${i}a`, `opt${i}b`, `opt${i}c`, `opt${i}d`],
    correct_index: i % 4,
    explanation: `Explanation ${i}. Second sentence.`,
  }
}

/** Build injected deps that return a fixed deck + a fixed number of questions. */
function deps(detail: PresentationDetail, n: number): ConvertDeps {
  return {
    fetchSlides: async () => detail,
    runAi: async () =>
      JSON.stringify({ questions: Array.from({ length: n }, (_, i) => mkQuestion(i)) }),
  }
}

// ── extractContentSlides ────────────────────────────────────────────────────

describe('extractContentSlides', () => {
  it('keeps slides with text and skips image-only slides', () => {
    const slides = [
      contentSlide(1, 'Alpha'),
      { order: 2, title: '', bodyHTML: '', notes: '', SlideOptions: [], image: 'x.png' },
      { order: 3, title: '', SlideOptions: [{ title: 'opt', correct: true }] },
    ]
    const out = extractContentSlides(slides as never)
    expect(out.map((s) => s.order)).toEqual([1, 3])
  })

  it('strips HTML from body and title', () => {
    const out = extractContentSlides([
      { order: 1, titleHTML: '<b>Hi</b>', bodyHTML: '<p>Hello &amp; bye</p>' },
    ] as never)
    expect(out[0].title).toBe('Hi')
    expect(out[0].body).toBe('Hello & bye')
  })
})

// ── validateQuestion / parseAiQuestions ──────────────────────────────────────

describe('validateQuestion (exactly 4 options / exactly 1 correct)', () => {
  it('accepts a clean 4-option question', () => {
    expect(validateQuestion(mkQuestion(0))).not.toBeNull()
  })

  it('rejects when options !== 4', () => {
    expect(validateQuestion({ ...mkQuestion(0), options: ['a', 'b', 'c'] })).toBeNull()
    expect(
      validateQuestion({ ...mkQuestion(0), options: ['a', 'b', 'c', 'd', 'e'] }),
    ).toBeNull()
  })

  it('rejects an out-of-range correct_index', () => {
    expect(validateQuestion({ ...mkQuestion(0), correct_index: 4 })).toBeNull()
    expect(validateQuestion({ ...mkQuestion(0), correct_index: -1 })).toBeNull()
  })

  it('dedupes repeated options (then fails the 4-option check)', () => {
    expect(
      validateQuestion({ ...mkQuestion(0), options: ['a', 'a', 'b', 'c'] }),
    ).toBeNull()
  })

  it('caps explanations to 4 sentences', () => {
    const v = validateQuestion({
      ...mkQuestion(0),
      explanation: 'One. Two. Three. Four. Five. Six.',
    })
    expect(v).not.toBeNull()
    expect(v!.explanation.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(4)
  })

  it('parses fenced JSON and drops malformed entries', () => {
    const raw =
      '```json\n{"questions":[' +
      JSON.stringify(mkQuestion(0)) +
      ',{"question":"bad","options":["a","b"],"correct_index":0,"explanation":"x"}]}\n```'
    const qs = parseAiQuestions(raw)
    expect(qs).toHaveLength(1)
  })
})

// ── buildAndSaveLesson: persistence + interleave ─────────────────────────────

describe('buildAndSaveLesson — 10 questions → 20 interleaved slides', () => {
  it('saves one lessons row + 20 ordered Q/E lesson_slides', async () => {
    const d = deck(Array.from({ length: 12 }, (_, i) => contentSlide(i + 1, `S${i}`)))
    const res = await buildAndSaveLesson(env.DB, deps(d, 10), {
      presentationId: '431816',
      token: 't',
    })

    expect(res.question_count).toBe(10)
    expect(res.warning).toBeUndefined()

    const lesson = await env.DB.prepare(
      `SELECT id, title, language, source_presentation_id, estimated_duration_minutes, status
         FROM lessons WHERE id = ?`,
    )
      .bind(res.lesson_id)
      .first<Record<string, unknown>>()
    expect(lesson).not.toBeNull()
    expect(lesson!.title).toBe('Test Deck')
    expect(lesson!.language).toBe('en')
    expect(lesson!.source_presentation_id).toBe(431816)
    expect(lesson!.status).toBe('draft')

    const { results } = await env.DB.prepare(
      `SELECT "order", type, content FROM lesson_slides WHERE lesson_id = ? ORDER BY "order"`,
    )
      .bind(res.lesson_id)
      .all<{ order: number; type: string; content: string }>()

    expect(results).toHaveLength(20)
    // Even orders are questions, odd are explanations: Q1,E1,Q2,E2,…
    results!.forEach((row, i) => {
      expect(row.order).toBe(i)
      expect(row.type).toBe(i % 2 === 0 ? 'question' : 'explanation')
      const c = JSON.parse(row.content)
      if (i % 2 === 0) {
        expect(c.options).toHaveLength(4)
        expect(typeof c.correct_index).toBe('number')
        expect(c.correct_index).toBeGreaterThanOrEqual(0)
        expect(c.correct_index).toBeLessThanOrEqual(3)
      } else {
        expect(typeof c.explanation).toBe('string')
        expect(c.explanation.length).toBeGreaterThan(0)
      }
    })
  })
})

describe('buildAndSaveLesson — error + warning paths', () => {
  it('throws 422 when fewer than 3 content slides', async () => {
    const d = deck([contentSlide(1, 'A'), contentSlide(2, 'B')])
    await expect(
      buildAndSaveLesson(env.DB, deps(d, 10), { presentationId: '1', token: 't' }),
    ).rejects.toMatchObject({ status: 422 })

    const { results } = await env.DB.prepare(`SELECT id FROM lessons`).all()
    expect(results).toHaveLength(0)
  })

  it('returns a warning when fewer than 10 questions are supported', async () => {
    // 4 content slides → target capped at 4; AI returns 4 → warning.
    const d = deck(Array.from({ length: 4 }, (_, i) => contentSlide(i + 1, `S${i}`)))
    const res = await buildAndSaveLesson(env.DB, deps(d, 4), {
      presentationId: '2',
      token: 't',
    })
    expect(res.question_count).toBe(4)
    expect(res.warning).toBeTruthy()

    const { results } = await env.DB.prepare(
      `SELECT id FROM lesson_slides WHERE lesson_id = ?`,
    )
      .bind(res.lesson_id)
      .all()
    expect(results).toHaveLength(8) // 4 Q + 4 E
  })

  it('throws 422 when the model cannot produce the minimum 3 questions', async () => {
    const d = deck(Array.from({ length: 5 }, (_, i) => contentSlide(i + 1, `S${i}`)))
    const badDeps: ConvertDeps = {
      fetchSlides: async () => d,
      runAi: async () => JSON.stringify({ questions: [mkQuestion(0), mkQuestion(1)] }),
    }
    await expect(
      buildAndSaveLesson(env.DB, badDeps, { presentationId: '3', token: 't' }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('carries the source language onto the lesson (language passthrough)', async () => {
    const d = deck(
      Array.from({ length: 6 }, (_, i) => contentSlide(i + 1, `S${i}`)),
      'vi',
      'Bài học',
    )
    const res = await buildAndSaveLesson(env.DB, deps(d, 10), {
      presentationId: '4',
      token: 't',
    })
    const lesson = await env.DB.prepare(`SELECT language, title FROM lessons WHERE id = ?`)
      .bind(res.lesson_id)
      .first<{ language: string; title: string }>()
    expect(lesson!.language).toBe('vi')
    expect(lesson!.title).toBe('Bài học')
  })

  it('drops invalid questions returned by the model (validation in pipeline)', async () => {
    const d = deck(Array.from({ length: 12 }, (_, i) => contentSlide(i + 1, `S${i}`)))
    // 10 good + 2 malformed → only 10 valid kept.
    const mixedDeps: ConvertDeps = {
      fetchSlides: async () => d,
      runAi: async () =>
        JSON.stringify({
          questions: [
            ...Array.from({ length: 10 }, (_, i) => mkQuestion(i)),
            { question: 'no opts', options: [], correct_index: 0, explanation: 'x' },
            { question: 'bad idx', options: ['a', 'b', 'c', 'd'], correct_index: 9, explanation: 'x' },
          ],
        }),
    }
    const res = await buildAndSaveLesson(env.DB, mixedDeps, {
      presentationId: '5',
      token: 't',
    })
    expect(res.question_count).toBe(10)
  })
})

// ── Route-level wiring ───────────────────────────────────────────────────────

describe('POST /api/lessons/convert — route wiring', () => {
  it('400 when presentation_id is missing', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/lessons/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('405 for a non-POST method', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/lessons/convert`, { method: 'GET' })
    expect(res.status).toBe(405)
  })

  it('does not collide with GET /api/lessons/:id (convert is not an id)', async () => {
    // The bare-id GET for a non-existent lesson "convert" must never run; the
    // convert route intercepts first (GET → 405, not 404).
    const res = await SELF.fetch(`${ORIGIN}/api/lessons/convert`, { method: 'GET' })
    expect(res.status).toBe(405)
  })
})

// ── WAT-11 regeneration helpers (mocked deps) ────────────────────────────────

describe('regenerateLessonAll / regenerateOneQuestion (WAT-11)', () => {
  async function seedLesson(id: string, n: number): Promise<void> {
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO lessons
         (id, presentation_id, title, description, slides, status,
          created_at, updated_at, published_at,
          owner_id, source_presentation_id, estimated_duration_minutes, language, reviewed)
       VALUES (?, 7, 'T', '', '[]', 'draft', ?, ?, NULL, NULL, 7, 5, 'en', 0)`,
    )
      .bind(id, now, now)
      .run()
    let order = 0
    for (let i = 0; i < n; i++) {
      await env.DB.prepare(
        `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'question', ?)`,
      )
        .bind(`q${id}${i}`, id, order++, JSON.stringify({ question: `old Q${i}`, options: ['a','b','c','d'], correct_index: 0 }))
        .run()
      await env.DB.prepare(
        `INSERT INTO lesson_slides (id, lesson_id, "order", type, content) VALUES (?, ?, ?, 'explanation', ?)`,
      )
        .bind(`e${id}${i}`, id, order++, JSON.stringify({ explanation: `old E${i}` }))
        .run()
    }
  }

  it('regenerateLessonAll replaces all slides with fresh interleaved Q/E', async () => {
    await seedLesson('LA', 3)
    const deck = { name: 'D', language: 'en', Slides: Array.from({ length: 5 }, (_, i) => contentSlide(i + 1, `S${i}`)) }
    const d = deps(deck as never, 5)
    const res = await regenerateLessonAll(env.DB, d, 'LA', '7', 't')
    expect(res.question_count).toBe(5)

    const { results } = await env.DB.prepare(
      `SELECT type, content FROM lesson_slides WHERE lesson_id = 'LA' ORDER BY "order"`,
    ).all<{ type: string; content: string }>()
    expect(results!.length).toBe(10) // 5 Q + 5 E
    expect(results![0].type).toBe('question')
    expect(results![1].type).toBe('explanation')
    // Fresh content (mkQuestion shape), not the old seeded text.
    expect(JSON.parse(results![0].content).question).not.toMatch(/old Q/)
  })

  it('regenerateOneQuestion returns one fresh validated question', async () => {
    const deck = { name: 'D', language: 'en', Slides: Array.from({ length: 4 }, (_, i) => contentSlide(i + 1, `S${i}`)) }
    const d = deps(deck as never, 3)
    const q = await regenerateOneQuestion(d, '7', 't')
    expect(q.options).toHaveLength(4)
    expect(q.correct_index).toBeGreaterThanOrEqual(0)
    expect(q.correct_index).toBeLessThanOrEqual(3)
    expect(q.question).toBeTruthy()
    expect(q.explanation).toBeTruthy()
  })
})
