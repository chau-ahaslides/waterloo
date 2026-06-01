// Lessons API client (WAT-3).
//
// Talks to the SAME-ORIGIN Waterloo Worker at relative `/api/lessons...`, which
// persists lessons in D1. This replaces the old localStorage persistence: the
// editor saves/loads here, the converter seeds a draft here, and Take/Play/
// Report load a lesson from here. No auth token is needed for these routes.

import { ApiError } from './presentations'
import type { Lesson } from '@/lessons/lessons'

export type { ApiError }

/** Fields a client may send when creating/updating a lesson (save draft). */
export interface LessonUpsert {
  id: string
  presentationId?: number
  title: string
  description?: string
  slides: Lesson['slides']
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

/** List all lessons, newest-updated first. */
export async function fetchLessons(): Promise<Lesson[]> {
  const res = await fetch('/api/lessons')
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { lessons: Lesson[] }
  return body.lessons ?? []
}

/** Fetch ONE lesson by id, or null if it doesn't exist. */
export async function fetchLesson(id: string): Promise<Lesson | null> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { lesson: Lesson }
  return body.lesson
}

/**
 * Create OR update a lesson (save draft). Upsert keyed by `id`; the server
 * preserves an existing lesson's status/createdAt and bumps updatedAt.
 */
export async function saveLesson(input: LessonUpsert): Promise<Lesson> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(input.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { lesson: Lesson }
  return body.lesson
}

/** Publish a lesson: status → published, sets publishedAt. */
export async function publishLesson(id: string): Promise<Lesson> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  })
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { lesson: Lesson }
  return body.lesson
}

/** Delete a lesson by id. */
export async function deleteLesson(id: string): Promise<void> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) await parseError(res)
}
