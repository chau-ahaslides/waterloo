import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchPresentationSlides,
  fetchPickAnswerSlides,
  isPickAnswerSlide,
  type RawSlide,
} from './slides'
import { ApiError } from './presentations'

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// isPickAnswerSlide — pure logic, no fetch needed
// ---------------------------------------------------------------------------
describe('isPickAnswerSlide', () => {
  it('returns true for classic multiple-choice (slideType null)', () => {
    const slide: RawSlide = { id: 1, type: 'pickAnswer', slideType: null, title: 'Q?', order: 1 }
    expect(isPickAnswerSlide(slide)).toBe(true)
  })

  it('returns true for imageChoice variant', () => {
    const slide: RawSlide = { id: 2, type: 'pickAnswer', slideType: 'imageChoice', title: 'Q?', order: 1 }
    expect(isPickAnswerSlide(slide)).toBe(true)
  })

  it('returns false for typeAnswer variant (no options)', () => {
    const slide: RawSlide = { id: 3, type: 'pickAnswer', slideType: 'typeAnswer', title: 'Q?', order: 1 }
    expect(isPickAnswerSlide(slide)).toBe(false)
  })

  it('returns false for non-pickAnswer types', () => {
    const slide: RawSlide = { id: 4, type: 'openEnded', slideType: null, title: 'Q?', order: 1 }
    expect(isPickAnswerSlide(slide)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fetchPresentationSlides — API client (fetch mocked)
// ---------------------------------------------------------------------------
describe('fetchPresentationSlides', () => {
  it('throws ApiError(401) when no token provided', async () => {
    // getToken() reads window.location.search — empty here
    Object.defineProperty(window, 'location', { value: { search: '' }, writable: true })
    await expect(fetchPresentationSlides(1)).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
  })

  it('calls the correct URL with Authorization header', async () => {
    const slides: RawSlide[] = [{ id: 10, type: 'pickAnswer', slideType: null, title: 'Q', order: 1 }]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ Slides: slides }),
    } as unknown as Response)

    await fetchPresentationSlides(99, 'jwt-token')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url as string).toContain('/api/presentation/detail/99')
    expect((options as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-token' })
  })

  it('returns the Slides array from the response', async () => {
    const slides: RawSlide[] = [
      { id: 1, type: 'pickAnswer', slideType: null, title: 'Q1', order: 1 },
      { id: 2, type: 'openEnded', slideType: null, title: 'Q2', order: 2 },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ Slides: slides }),
    } as unknown as Response)

    const result = await fetchPresentationSlides(99, 'tok')
    expect(result).toHaveLength(2)
  })

  it('returns [] when response has no Slides array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response)

    const result = await fetchPresentationSlides(99, 'tok')
    expect(result).toEqual([])
  })

  it('throws ApiError(401) on a 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as unknown as Response)
    await expect(fetchPresentationSlides(99, 'bad')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Unauthorized — the token is invalid or expired.',
    })
  })
})

// ---------------------------------------------------------------------------
// fetchPickAnswerSlides — filters + sorts
// ---------------------------------------------------------------------------
describe('fetchPickAnswerSlides', () => {
  it('returns only pickAnswer option-backed slides, sorted by order', async () => {
    const slides: RawSlide[] = [
      { id: 3, type: 'openEnded', slideType: null, title: 'Q3', order: 3 },
      { id: 1, type: 'pickAnswer', slideType: null, title: 'Q1', order: 1 },
      { id: 2, type: 'pickAnswer', slideType: 'typeAnswer', title: 'Q2', order: 2 }, // excluded
      { id: 4, type: 'pickAnswer', slideType: 'imageChoice', title: 'Q4', order: 0 },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ Slides: slides }),
    } as unknown as Response)

    const result = await fetchPickAnswerSlides(10, 'tok')
    // Only ids 1 and 4, sorted by order ascending
    expect(result.map((s) => s.id)).toEqual([4, 1])
  })
})
