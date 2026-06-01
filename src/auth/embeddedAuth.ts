// Embedded SSO auth for Waterloo.
// ---------------------------------------------------------------------------
// Two deployment modes, ONE token-acquisition path:
//
//  1. EMBEDDED on an *.ahaslides.com / *.ahaslide.com origin
//     ------------------------------------------------------------------
//     When the app is served on (or iframed under) an ahaslides.com origin,
//     the logged-in user's session is carried by the `ahaToken` cookie that
//     the general AhaSlides web app sets on the `.ahaslides.com` /
//     `.ahaslide.com` root domains (confirmed in stpancras-audience-app:
//     `src/App.vue` reads `cookie.getValue('ahaToken')`, `src/util.js`
//     `setCookieToken` writes it to `.ahaslides.com`/`.ahaslide.com`).
//
//     That domain cookie is NOT itself the bearer we send to the presenter
//     API. Per the tech lead: the Survey app (and we, matching it) perform a
//     SWAP-TOKEN request against the *general* API — present the domain
//     session, get back a freshly-minted JWT scoped for this app — and use
//     that minted JWT as `Authorization: Bearer` for presenter API calls.
//     The minted JWT is cached in memory (and optionally sessionStorage) for
//     the page lifetime.
//
//  2. STANDALONE on *.workers.dev (or local dev)
//     ------------------------------------------------------------------
//     On https://waterloo.ahaslides-game.workers.dev there is no
//     `.ahaslides.com` domain cookie (different registrable domain), so the
//     swap path is skipped entirely and we fall back to the existing
//     `?token=…` URL param, then the hard-coded DEV_TOKEN. This keeps the
//     live standalone deploy loading data exactly as before — the new auth
//     path is purely ADDITIVE and only activates where the cookie exists.
//
// ---------------------------------------------------------------------------
// ⚠️ ENDPOINT ASSUMPTION — confirm with the platform/Survey team.
//   The exact swap-token URL + request shape live in the general-API server
//   repo, which is not checked out here. The audience app only reads the
//   `ahaToken` cookie and sends it straight as a bearer (no swap), so the
//   swap route could not be pinned down from the sibling repos. We therefore
//   ship against the MOST LIKELY endpoint and make every part of the contract
//   overridable via Vite env vars so it can be corrected with a one-line
//   config change (no code edit):
//
//     VITE_GENERAL_API_BASE   default https://api.ahaslides.com
//                             (verified to be the real general-API host:
//                              GET /api/presentation/list/infinity-scroll/v2
//                              returns 401 {"success":false} = route exists,
//                              auth required; unknown paths return a 404
//                              welcome message.)
//     VITE_SWAP_TOKEN_PATH    default /api/auth/swap-token  (tech-lead phrasing)
//     VITE_AUTH_COOKIE_NAME   default ahaToken              (confirmed)
//
//   The swap response is parsed leniently: we accept `token`, `accessToken`,
//   `access_token`, or `jwt` (string), optionally nested under `result`/`data`.
// ---------------------------------------------------------------------------

const GENERAL_API_BASE =
  import.meta.env.VITE_GENERAL_API_BASE ?? 'https://api.ahaslides.com'
const SWAP_TOKEN_PATH =
  import.meta.env.VITE_SWAP_TOKEN_PATH ?? '/api/auth/swap-token'
const AUTH_COOKIE_NAME =
  import.meta.env.VITE_AUTH_COOKIE_NAME ?? 'ahaToken'

const SESSION_CACHE_KEY = 'waterloo.swapToken'

/** Read a cookie value by name from document.cookie. Returns null if absent. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  const prefixed = `; ${document.cookie}`
  const parts = prefixed.split(`; ${name}=`)
  if (parts.length === 2) {
    return parts.pop()!.split(';').shift() ?? null
  }
  return null
}

/** The raw domain session cookie set by the general AhaSlides app on
 *  `.ahaslides.com` / `.ahaslide.com`. Present only when embedded on such an
 *  origin. */
export function getDomainCookieToken(): string | null {
  return readCookie(AUTH_COOKIE_NAME)
}

/** True when the app is running with a domain SSO cookie available — i.e.
 *  embedded on an ahaslides.com origin rather than the standalone workers.dev
 *  / local deploy. */
export function isEmbedded(): boolean {
  return getDomainCookieToken() !== null
}

// In-memory cache of the swapped JWT for the page lifetime. Survives across
// API calls so we only hit the swap endpoint once.
let cachedSwapToken: string | null | undefined
// De-dupes concurrent swaps: if two API calls race on first load, they share
// one in-flight swap request rather than firing two.
let inFlightSwap: Promise<string | null> | null = null

/** Extract a JWT string from a variety of plausible swap-response shapes. */
function extractToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const containers = [obj, obj.result, obj.data].filter(
    (c): c is Record<string, unknown> => !!c && typeof c === 'object',
  )
  for (const c of containers) {
    for (const key of ['token', 'accessToken', 'access_token', 'jwt']) {
      const v = c[key]
      if (typeof v === 'string' && v.length > 0) return v
    }
  }
  return null
}

/** Read a previously-swapped JWT from sessionStorage, if any. */
function readSessionCache(): string | null {
  try {
    return sessionStorage.getItem(SESSION_CACHE_KEY)
  } catch {
    return null // sessionStorage may be unavailable (privacy mode, SSR)
  }
}

function writeSessionCache(token: string): void {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, token)
  } catch {
    // best-effort only; in-memory cache still covers the page lifetime
  }
}

/**
 * Perform the cookie → swap-token → JWT exchange against the general API.
 *
 * Returns the minted JWT, or `null` if there is no domain cookie or the swap
 * fails for any reason (network, non-2xx, unparseable body). A `null` return
 * means "I could not mint an embedded token" — the caller then falls back to
 * the standalone `?token=` / DEV_TOKEN path. The swap NEVER throws.
 */
async function swapDomainCookieForJwt(): Promise<string | null> {
  const cookieToken = getDomainCookieToken()
  if (!cookieToken) return null // standalone deploy — no embedded session

  try {
    const res = await fetch(`${GENERAL_API_BASE}${SWAP_TOKEN_PATH}`, {
      method: 'POST',
      // Send credentials so an HttpOnly variant of the session cookie also
      // rides along; harmless when the cookie is readable client-side.
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        // Present the domain session both as a bearer and in the body so the
        // endpoint can read it whichever way it expects.
        Authorization: `Bearer ${cookieToken}`,
      },
      body: JSON.stringify({ token: cookieToken }),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    return extractToken(body)
  } catch {
    return null // graceful: any failure → caller uses standalone fallback
  }
}

/**
 * Resolve the embedded JWT, swapping the domain cookie at most once per page
 * and caching the result (memory + sessionStorage). Returns `null` when not
 * embedded or when the swap fails.
 */
export async function getEmbeddedToken(): Promise<string | null> {
  if (cachedSwapToken !== undefined) return cachedSwapToken

  const fromSession = readSessionCache()
  if (fromSession) {
    cachedSwapToken = fromSession
    return cachedSwapToken
  }

  // Coalesce concurrent first-load swaps into one request.
  if (!inFlightSwap) {
    inFlightSwap = swapDomainCookieForJwt().then((tok) => {
      cachedSwapToken = tok
      if (tok) writeSessionCache(tok)
      inFlightSwap = null
      return tok
    })
  }
  return inFlightSwap
}

/** Test-only: clear the in-memory + sessionStorage swap caches. */
export function _resetEmbeddedAuthCache(): void {
  cachedSwapToken = undefined
  inFlightSwap = null
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY)
  } catch {
    // ignore
  }
}
