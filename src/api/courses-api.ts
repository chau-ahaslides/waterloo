// Courses feature API client (WAT-10).
//
// Talks to the same-origin Waterloo Worker at relative `/api/courses/...`.
// These routes service the NORMALIZED Courses model (lessons + lesson_slides),
// distinct from the legacy JSON-blob lessons used by the editor/player routes.
//
// `POST /api/lessons/convert` is the AI-generation endpoint (WAT-9); the list
// endpoint `GET /api/courses/lessons` is added in WAT-10 to expose the lessons
// that the convert endpoint produces.

import { ApiError } from './presentations'

export type { ApiError }

// ── Normalized lesson (from the WAT-9 convert pipeline) ─────────────────────

export interface NormalizedLesson {
  id: string
  /** Presentation the lesson was AI-generated from. */
  sourcePresentationId: number | null
  title: string
  /** 'draft' | 'published' */
  status: 'draft' | 'published'
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** Approximate duration in minutes. */
  estimatedDurationMinutes: number | null
  /** BCP-47 language code inferred from the source deck. */
  language: string | null
  /** Number of lesson_slides rows (Q + E interleaved). */
  slideCount: number
}

export interface ConvertResult {
  lesson_id: string
  question_count: number
  warning?: string
}

async function parseError(res: Response): Promise<never> {
  let message = `Request failed (${res.status}).`
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) message = body.error
  } catch {
    // non-JSON body — keep generic
  }
  throw new ApiError(message, res.status)
}

/** List all normalized lessons (WAT-9 convert output), newest first. */
export async function fetchNormalizedLessons(): Promise<NormalizedLesson[]> {
  const res = await fetch('/api/courses/lessons')
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { lessons: NormalizedLesson[] }
  return body.lessons ?? []
}

/**
 * Trigger AI conversion of ONE presentation into a normalized lesson.
 * Returns { lesson_id, question_count, warning? }.
 * Takes ~10–30 s (Workers AI). Throws ApiError on failure.
 */
export async function convertPresentation(presentationId: number): Promise<ConvertResult> {
  const res = await fetch('/api/lessons/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presentation_id: presentationId }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<ConvertResult>
}
