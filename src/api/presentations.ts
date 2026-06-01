// AhaSlides presentation-list API client.
//
// Auth — two paths, picked automatically at runtime:
//
//  • EMBEDDED (served on / iframed under an *.ahaslides.com origin): the
//    logged-in user's `ahaToken` domain cookie is swapped for a freshly-minted
//    JWT via the general API (see `src/auth/embeddedAuth.ts`), and that JWT is
//    sent as `Authorization: Bearer <jwt>`. This is the real SSO path.
//
//  • STANDALONE (the *.workers.dev deploy or local dev): no domain cookie
//    exists, so we fall back — exactly as before — to the `?token=…` URL param
//    and then the hard-coded DEV_TOKEN. The standalone deploy is unaffected by
//    the embedded path.
//
// The dev API allows CORS from any origin (`access-control-allow-origin: *`,
// `access-control-allow-headers: authorization`), so the browser calls it
// directly — no proxy needed.

import { getDomainCookieToken, getEmbeddedToken } from '@/auth/embeddedAuth'

const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://presenter.dev.ahaslide.com'

// TEMPORARY dev/inspection default — hard-coded so the bare URL
// https://waterloo.ahaslides-game.workers.dev/ works without a ?token= param.
// This exposes one account's presentations to anyone with the bare URL;
// REMOVE before any real / multi-user use. Only ever reached on the standalone
// deploy (no domain cookie); embedded origins use the swapped JWT instead.
const DEV_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI3NTcsImlhdCI6MTc3OTI3NTUyMywiZXhwIjoxODQyMzQ3NTIzfQ.iVJ3bRoDOJ4mTag8DeBAEG3nujfYNK2vVWSH6pgxtLc'

/** Synchronous best-effort token, used for UI gating (`hasToken`) only.
 *
 *  Returns, in priority order: the raw domain SSO cookie (embedded), the
 *  `?token=` URL param, then DEV_TOKEN. NOTE: when embedded, the value
 *  returned here is the raw domain cookie, NOT the swapped JWT — it is only
 *  used to answer "is there *some* auth?" for UI display. Actual API calls go
 *  through `resolveAuthToken()`, which performs the cookie→swap→JWT exchange. */
export function getToken(): string | null {
  return (
    getDomainCookieToken() ??
    new URLSearchParams(window.location.search).get('token') ??
    DEV_TOKEN
  )
}

/** Resolve the bearer token to send on a presenter API request.
 *
 *  EMBEDDED: swap the `ahaToken` domain cookie for a minted JWT (cached). If
 *  the swap succeeds, that JWT is used. STANDALONE (or swap failure): fall
 *  back gracefully to the synchronous `?token=` / DEV_TOKEN path so the live
 *  workers.dev deploy keeps loading data. */
export async function resolveAuthToken(): Promise<string | null> {
  const embedded = await getEmbeddedToken()
  if (embedded) return embedded
  // No domain cookie, or swap failed → standalone fallback.
  return getToken()
}

export interface Presentation {
  id: number
  name: string
  accessCode: string
  slideCount: number
  participantsCount: number
  onlineCount: number
  presenting: boolean
  language: string | null
  folderId: number | null
  thumbnailImage: string | null
  customThumbnailImage: string | null
  createdAt: string
  modifiedAt: string
  lastEditedAt: string
  // The endpoint returns many more fields; these are the ones the UI uses.
  [key: string]: unknown
}

export interface PresentationListResponse {
  result: Presentation[]
  numberOfPresentations: number
  numberOfPresentationPages: number
}

export type SortColumn = 'lastEditedAt' | 'createdAt' | 'name'
export type SortOrder = 'asc' | 'desc'

export interface ListParams {
  page?: number
  sortColumn?: SortColumn
  sortOrder?: SortOrder
  includeShared?: boolean
  folderId?: string | number | ''
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Fetch one page of the presentation list.
 * Mirrors GET /api/presentation/list/infinity-scroll/v2.
 */
export async function fetchPresentationList(
  params: ListParams = {},
  token?: string | null,
): Promise<PresentationListResponse> {
  // When no explicit token is passed, resolve via the embedded swap path
  // (falling back to ?token= / DEV_TOKEN on the standalone deploy).
  if (token === undefined) {
    token = await resolveAuthToken()
  }
  if (!token) {
    throw new ApiError('Missing token — add ?token=… to the URL.', 401)
  }

  const {
    page = 1,
    sortOrder = 'desc',
    sortColumn = 'lastEditedAt',
    includeShared = true,
    folderId = '',
  } = params

  const qs = new URLSearchParams({
    page: String(page),
    sortOrder,
    sortColumn,
    includeShared: String(includeShared),
    folderId: String(folderId),
  })

  const res = await fetch(
    `${API_BASE}/api/presentation/list/infinity-scroll/v2?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Unauthorized — the token is invalid or expired.'
        : `Request failed (${res.status}).`
    throw new ApiError(msg, res.status)
  }

  return res.json() as Promise<PresentationListResponse>
}
