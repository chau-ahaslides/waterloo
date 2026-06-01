// AhaSlides slide-content API client.
//
// Auth: same scheme as presentations.ts — the JWT is read from `?token=…` and
// sent as `Authorization: Bearer <token>`. The dev API is CORS-open, so the
// browser calls it directly.
//
// --- Confirmed endpoint + shape (probed 2026-06-01 against the dev API) ---
//
// GET /api/presentation/detail/<presentationId>
//   → the full presentation object. Its `Slides` array holds every slide with
//     full content (the shallow `GET /api/slide/list?presentationId=` only
//     returns id/type/order, NOT the question text or answer options, so it is
//     not enough to build a lesson).
//
// A "pick answer" slide is `slide.type === 'pickAnswer'`. That family has a
// `slideType` discriminator:
//   - null         → classic multiple-choice quiz  (the canonical "pick answer")
//   - 'imageChoice'→ pick-an-image multiple choice
//   - 'typeAnswer' → short text answer  (no options — excluded)
//   - 'matchPairs' / 'correctOrder' → other quiz variants
// We treat the option-backed variants (multiple choice + image choice) as
// "pick answer" and skip the text/match/order variants, mirroring the audience
// app's `getCorrectSlideTypeName` mapping in stpancras-audience-app/src/util.js.
//
// Question text:  slide.title
// Answer options: slide.SlideOptions[] — each { id, title, correct, order, image }
//   - title   → the option's text
//   - correct → boolean, marks the right answer(s)
//   - image   → optional image URL (image-choice slides)

import { ApiError, getToken } from './presentations'

const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://presenter.dev.ahaslide.com'

/** Raw option as returned inside a slide's `SlideOptions` array. */
export interface RawSlideOption {
  id: number
  title: string | null
  correct: boolean
  order: number
  image?: string | null
  [key: string]: unknown
}

/** Raw slide as returned inside the presentation-detail `Slides` array. */
export interface RawSlide {
  id: number
  type: string
  slideType: string | null
  title: string | null
  order: number
  SlideOptions?: RawSlideOption[]
  [key: string]: unknown
}

/** `pickAnswer` slideType variants that carry selectable answer options. */
const PICK_ANSWER_OPTION_VARIANTS: ReadonlyArray<string | null> = [
  null, // classic multiple-choice quiz
  'imageChoice', // pick-an-image multiple choice
]

/**
 * True when a slide is a "pick answer" (multiple-choice) slide with options —
 * i.e. `type === 'pickAnswer'` and an option-backed `slideType` variant.
 */
export function isPickAnswerSlide(slide: RawSlide): boolean {
  return (
    slide.type === 'pickAnswer' &&
    PICK_ANSWER_OPTION_VARIANTS.includes(slide.slideType)
  )
}

/**
 * Fetch the full presentation detail and return its raw `Slides` array.
 * Mirrors GET /api/presentation/detail/<id>.
 */
export async function fetchPresentationSlides(
  presentationId: number | string,
  token = getToken(),
): Promise<RawSlide[]> {
  if (!token) {
    throw new ApiError('Missing token — add ?token=… to the URL.', 401)
  }

  const res = await fetch(
    `${API_BASE}/api/presentation/detail/${presentationId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Unauthorized — the token is invalid or expired.'
        : `Failed to load presentation ${presentationId} (${res.status}).`
    throw new ApiError(msg, res.status)
  }

  const data = (await res.json()) as { Slides?: RawSlide[] }
  return Array.isArray(data.Slides) ? data.Slides : []
}

/** Fetch only the "pick answer" slides of a presentation, in display order. */
export async function fetchPickAnswerSlides(
  presentationId: number | string,
  token = getToken(),
): Promise<RawSlide[]> {
  const slides = await fetchPresentationSlides(presentationId, token)
  return slides
    .filter(isPickAnswerSlide)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
