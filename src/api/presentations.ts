// AhaSlides presentation-list API client.
//
// Auth: the JWT is read from the page URL (`?token=…`) and sent as
// `Authorization: Bearer <token>`. The dev API allows CORS from any origin
// (`access-control-allow-origin: *`, `access-control-allow-headers:
// authorization`), so the browser can call it directly — no proxy needed.

const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://presenter.dev.ahaslide.com'

// TEMPORARY dev/inspection default — hard-coded so the bare URL
// https://waterloo.ahaslides-game.workers.dev/ works without a ?token= param.
// This exposes one account's presentations to anyone with the bare URL;
// REMOVE before any real / multi-user use.
const DEV_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI3NTcsImlhdCI6MTc3OTI3NTUyMywiZXhwIjoxODQyMzQ3NTIzfQ.iVJ3bRoDOJ4mTag8DeBAEG3nujfYNK2vVWSH6pgxtLc'

/** Read the bearer token from the current URL's `?token=` query param.
 *  Falls back to DEV_TOKEN when no param is present (temporary dev default). */
export function getToken(): string | null {
  return new URLSearchParams(window.location.search).get('token') ?? DEV_TOKEN
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
  token = getToken(),
): Promise<PresentationListResponse> {
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
