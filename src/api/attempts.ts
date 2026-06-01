// Lesson-attempts API client (WAT-5).
//
// Unlike presentations.ts (which calls the external AhaSlides presenter API),
// this talks to the SAME-ORIGIN Waterloo Worker at relative `/api/...`. The
// Worker persists attempts in D1. No auth token is needed for these routes.
//
// An ATTEMPT is one audience run of a lesson: their per-slide responses plus a
// score/total. Multiple attempts per lesson are allowed — every submission is a
// new row, so the report shows every run.

import { ApiError } from './presentations'

export type { ApiError }

/** One per-slide snapshot stored with an attempt (generic across slide types). */
export interface AttemptResponse {
  /** The lesson slide id (source presenter slide id). */
  slideId: number
  /** The slide-type key, e.g. 'pickAnswer'. */
  type: string
  /** Human-readable question/title snapshot for the report. */
  question: string
  /** The audience's answer payload (slide-type-defined; may be null). */
  response: unknown
  /** Whether this response was correct (slide-type-defined; null if N/A). */
  correct: boolean | null
}

/** A persisted lesson attempt, as returned by the API. */
export interface Attempt {
  id: string
  lessonId: string
  audienceName: string | null
  score: number
  total: number
  responses: AttemptResponse[]
  createdAt: string
}

/** The payload POSTed when an audience completes a lesson. */
export interface NewAttempt {
  audienceName?: string | null
  score: number
  total: number
  responses: AttemptResponse[]
}

async function parseError(res: Response): Promise<never> {
  let message = `Request failed (${res.status}).`
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) message = body.error
  } catch {
    // non-JSON error body — keep the generic message
  }
  throw new ApiError(message, res.status)
}

/**
 * Submit one attempt for a lesson. Returns the persisted attempt (with its
 * server-assigned id + createdAt). POSTs to the same-origin Worker.
 */
export async function submitAttempt(
  lessonId: string,
  attempt: NewAttempt,
): Promise<Attempt> {
  const res = await fetch(
    `/api/lessons/${encodeURIComponent(lessonId)}/attempts`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(attempt),
    },
  )
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { attempt: Attempt }
  return body.attempt
}

/** Fetch all attempts for a lesson, newest first (for the report). */
export async function fetchAttempts(lessonId: string): Promise<Attempt[]> {
  const res = await fetch(
    `/api/lessons/${encodeURIComponent(lessonId)}/attempts`,
  )
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { attempts: Attempt[] }
  return body.attempts ?? []
}
