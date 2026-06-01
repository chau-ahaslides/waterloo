import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readCookie,
  getDomainCookieToken,
  isEmbedded,
  getEmbeddedToken,
  _resetEmbeddedAuthCache,
} from './embeddedAuth'

// ---------------------------------------------------------------------------
// Helpers: drive document.cookie and fetch in jsdom.
// ---------------------------------------------------------------------------
function setCookieString(value: string) {
  Object.defineProperty(document, 'cookie', {
    value,
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  _resetEmbeddedAuthCache()
  setCookieString('')
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// readCookie / getDomainCookieToken / isEmbedded
// ---------------------------------------------------------------------------
describe('cookie reading', () => {
  it('reads a named cookie from document.cookie', () => {
    setCookieString('foo=1; ahaToken=abc.def.ghi; bar=2')
    expect(readCookie('ahaToken')).toBe('abc.def.ghi')
  })

  it('returns null when the cookie is absent', () => {
    setCookieString('foo=1; bar=2')
    expect(readCookie('ahaToken')).toBeNull()
    expect(getDomainCookieToken()).toBeNull()
  })

  it('isEmbedded() is true only when the domain cookie is present', () => {
    setCookieString('')
    expect(isEmbedded()).toBe(false)
    setCookieString('ahaToken=session-jwt')
    expect(isEmbedded()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getEmbeddedToken — the cookie → swap → JWT flow
// ---------------------------------------------------------------------------
describe('getEmbeddedToken (swap flow)', () => {
  it('returns null when there is no domain cookie (standalone deploy)', async () => {
    setCookieString('')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const tok = await getEmbeddedToken()
    expect(tok).toBeNull()
    // swap must NOT be attempted without a cookie
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('cookie present → calls swap endpoint and returns the minted JWT', async () => {
    setCookieString('ahaToken=domain-session-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'minted.jwt.value' }),
    } as unknown as Response)

    const tok = await getEmbeddedToken()
    expect(tok).toBe('minted.jwt.value')
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url as string).toContain('/api/auth/swap-token')
    const opts = options as RequestInit
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer domain-session-token',
    )
  })

  it('accepts alternative JWT field names (accessToken / nested result)', async () => {
    setCookieString('ahaToken=s')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: { accessToken: 'nested.jwt' } }),
    } as unknown as Response)
    expect(await getEmbeddedToken()).toBe('nested.jwt')
  })

  it('caches the swapped JWT — second call does not re-hit the endpoint', async () => {
    setCookieString('ahaToken=s')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'jwt1' }),
    } as unknown as Response)

    expect(await getEmbeddedToken()).toBe('jwt1')
    expect(await getEmbeddedToken()).toBe('jwt1')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent first-load swaps into a single request', async () => {
    setCookieString('ahaToken=s')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'jwt-c' }),
    } as unknown as Response)

    const [a, b] = await Promise.all([getEmbeddedToken(), getEmbeddedToken()])
    expect(a).toBe('jwt-c')
    expect(b).toBe('jwt-c')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('swap HTTP failure → returns null (graceful, no throw)', async () => {
    setCookieString('ahaToken=s')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
    } as unknown as Response)
    await expect(getEmbeddedToken()).resolves.toBeNull()
  })

  it('swap network error → returns null (graceful, no throw)', async () => {
    setCookieString('ahaToken=s')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(getEmbeddedToken()).resolves.toBeNull()
  })

  it('unparseable / tokenless swap body → returns null', async () => {
    setCookieString('ahaToken=s')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ unexpected: 'shape' }),
    } as unknown as Response)
    await expect(getEmbeddedToken()).resolves.toBeNull()
  })
})
