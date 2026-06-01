import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fetchPresentationList, ApiError, getToken, resolveAuthToken } from './presentations'
import { _resetEmbeddedAuthCache } from '@/auth/embeddedAuth'

// ---------------------------------------------------------------------------
// Mock window.location so getToken() can read query params
// ---------------------------------------------------------------------------
const originalLocation = window.location

function setCookieString(value: string) {
  Object.defineProperty(document, 'cookie', {
    value,
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  _resetEmbeddedAuthCache()
  setCookieString('') // no domain cookie unless a test opts in
})

afterEach(() => {
  vi.restoreAllMocks()
  // restore location after each test that may have changed it
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  setCookieString('')
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
  it('throws ApiError(401) when token is explicitly passed as null', async () => {
    setToken(null)
    // Pass null explicitly to bypass the DEV_TOKEN fallback in getToken()
    await expect(fetchPresentationList({}, null as unknown as string)).rejects.toMatchObject({
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

// ---------------------------------------------------------------------------
// Token acquisition: getToken() (sync, UI gating) + resolveAuthToken() (async)
// ---------------------------------------------------------------------------
describe('getToken (sync fallback)', () => {
  it('prefers the ?token= URL param over DEV_TOKEN when no cookie', () => {
    setCookieString('')
    setToken('url-token')
    expect(getToken()).toBe('url-token')
  })

  it('falls back to DEV_TOKEN when no cookie and no URL param', () => {
    setCookieString('')
    setToken(null)
    // DEV_TOKEN is a non-empty JWT string
    expect(getToken()).toMatch(/^eyJ/)
  })

  it('prefers the domain cookie when embedded', () => {
    setCookieString('ahaToken=domain-session')
    setToken('url-token')
    expect(getToken()).toBe('domain-session')
  })
})

describe('resolveAuthToken (async, embedded swap aware)', () => {
  it('embedded → swaps the cookie and returns the minted JWT', async () => {
    setCookieString('ahaToken=domain-session')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'minted.jwt' }),
    } as unknown as Response)
    await expect(resolveAuthToken()).resolves.toBe('minted.jwt')
  })

  it('standalone (no cookie) → falls back to ?token=', async () => {
    setCookieString('')
    setToken('url-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(resolveAuthToken()).resolves.toBe('url-token')
    expect(fetchSpy).not.toHaveBeenCalled() // no swap attempted standalone
  })

  it('swap failure while embedded → graceful fallback (raw domain cookie via getToken)', async () => {
    // When the swap endpoint fails but a domain cookie exists, getToken()'s
    // sync priority returns the raw cookie — the best available credential —
    // rather than ?token=. This keeps an embedded session working even if the
    // (assumed) swap path is wrong.
    setCookieString('ahaToken=domain-session')
    setToken('url-token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response)
    await expect(resolveAuthToken()).resolves.toBe('domain-session')
  })
})

describe('fetchPresentationList token resolution', () => {
  it('embedded: uses the swapped JWT as the bearer when no token arg passed', async () => {
    setCookieString('ahaToken=domain-session')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    // 1st call = swap; 2nd call = the presenter list request
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ token: 'minted.jwt' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: [],
          numberOfPresentations: 0,
          numberOfPresentationPages: 0,
        }),
      } as unknown as Response)

    await fetchPresentationList()
    const listCall = fetchSpy.mock.calls[1]
    expect((listCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer minted.jwt',
    })
  })

  it('standalone: uses the ?token= fallback as the bearer', async () => {
    setCookieString('')
    setToken('url-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [],
        numberOfPresentations: 0,
        numberOfPresentationPages: 0,
      }),
    } as unknown as Response)

    await fetchPresentationList()
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer url-token',
    })
  })
})
