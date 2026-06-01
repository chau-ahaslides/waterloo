// API-client tests for src/api/courses-api.ts (WAT-10).
//
// Tests the client functions with `fetch` mocked: assert correct URLs, request
// shape, response parsing, and ApiError on failure.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@/api/presentations'

// ── fetch mock setup ─────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
}

function lastFetch(): { url: string; opts: RequestInit | undefined } {
  const f = vi.mocked(fetch)
  const call = f.mock.calls[0]
  return { url: call[0] as string, opts: call[1] as RequestInit | undefined }
}

import { fetchNormalizedLessons, convertPresentation } from './courses-api'

beforeEach(() => {
  vi.restoreAllMocks()
})

// ── fetchNormalizedLessons ───────────────────────────────────────────────────

describe('fetchNormalizedLessons', () => {
  it('calls GET /api/courses/lessons and returns the lessons array', async () => {
    const lesson = {
      id: 'lesson_abc',
      sourcePresentationId: 42,
      title: 'Onboarding',
      status: 'draft',
      createdAt: '2026-06-01T00:00:00Z',
      estimatedDurationMinutes: 5,
      language: 'en',
      slideCount: 20,
    }
    mockFetch(200, { lessons: [lesson] })

    const result = await fetchNormalizedLessons()

    expect(lastFetch().url).toBe('/api/courses/lessons')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('lesson_abc')
    expect(result[0].title).toBe('Onboarding')
    expect(result[0].slideCount).toBe(20)
  })

  it('returns an empty array when lessons is missing from body', async () => {
    mockFetch(200, {})
    const result = await fetchNormalizedLessons()
    expect(result).toEqual([])
  })

  it('throws ApiError when the server returns non-ok', async () => {
    mockFetch(500, { error: 'Internal error' })
    await expect(fetchNormalizedLessons()).rejects.toThrow(ApiError)
  })

  it('includes the server error message in the thrown ApiError', async () => {
    mockFetch(404, { error: 'Not found' })
    try {
      await fetchNormalizedLessons()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).message).toBe('Not found')
    }
  })
})

// ── convertPresentation ──────────────────────────────────────────────────────

describe('convertPresentation', () => {
  it('calls POST /api/lessons/convert with the correct body', async () => {
    mockFetch(201, { lesson_id: 'lesson_xyz', question_count: 8 })

    await convertPresentation(42)

    const { url, opts } = lastFetch()
    expect(url).toBe('/api/lessons/convert')
    expect(opts?.method).toBe('POST')
    expect(opts?.headers).toMatchObject({ 'content-type': 'application/json' })
    const body = JSON.parse(opts?.body as string)
    expect(body).toEqual({ presentation_id: 42 })
  })

  it('returns the conversion result (lesson_id + question_count)', async () => {
    mockFetch(201, { lesson_id: 'lesson_xyz', question_count: 8 })
    const result = await convertPresentation(42)
    expect(result.lesson_id).toBe('lesson_xyz')
    expect(result.question_count).toBe(8)
    expect(result.warning).toBeUndefined()
  })

  it('includes warning when server returns one', async () => {
    mockFetch(201, { lesson_id: 'lesson_xyz', question_count: 4, warning: 'Only 4 questions' })
    const result = await convertPresentation(42)
    expect(result.warning).toBe('Only 4 questions')
  })

  it('throws ApiError on non-ok response', async () => {
    mockFetch(422, { error: 'Not enough content slides' })
    await expect(convertPresentation(42)).rejects.toThrow(ApiError)
  })
})
