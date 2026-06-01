import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPresentationList, ApiError } from './presentations'

// ---------------------------------------------------------------------------
// Mock window.location so getToken() can read query params
// ---------------------------------------------------------------------------
const originalLocation = window.location

afterEach(() => {
  vi.restoreAllMocks()
  // restore location after each test that may have changed it
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
})

function setToken(token: string | null) {
  const search = token ? `?token=${token}` : ''
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
  })
}

// ---------------------------------------------------------------------------
// fetchPresentationList
// ---------------------------------------------------------------------------
describe('fetchPresentationList', () => {
  it('throws ApiError(401) when no token is provided', async () => {
    setToken(null)
    await expect(fetchPresentationList()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
  })

  it('calls the correct URL with expected query params and Authorization header', async () => {
    const mockResponse: Response = {
      ok: true,
      json: vi.fn().mockResolvedValue({ result: [], numberOfPresentations: 0, numberOfPresentationPages: 0 }),
    } as unknown as Response
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    await fetchPresentationList(
      { page: 2, sortColumn: 'name', sortOrder: 'asc', includeShared: false, folderId: '5' },
      'test-jwt-token',
    )

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url as string).toContain('/api/presentation/list/infinity-scroll/v2')
    expect(url as string).toContain('page=2')
    expect(url as string).toContain('sortColumn=name')
    expect(url as string).toContain('sortOrder=asc')
    expect(url as string).toContain('includeShared=false')
    expect(url as string).toContain('folderId=5')
    expect((options as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-jwt-token',
    })
  })

  it('parses and returns the response body on success', async () => {
    const payload = {
      result: [{ id: 1, name: 'Demo' }],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response)

    const data = await fetchPresentationList({}, 'tok')
    expect(data.numberOfPresentations).toBe(1)
    expect(data.result[0].name).toBe('Demo')
  })

  it('throws ApiError(401) with specific message on 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
    } as unknown as Response)

    await expect(fetchPresentationList({}, 'bad-token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Unauthorized — the token is invalid or expired.',
    })
  })

  it('throws ApiError with status code on non-401 error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response)

    await expect(fetchPresentationList({}, 'tok')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    })
  })
})
