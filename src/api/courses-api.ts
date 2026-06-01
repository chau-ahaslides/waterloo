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

// ── Lesson detail / editor (WAT-11) ─────────────────────────────────────────

/** Content of a question slide (parsed from the slide's content blob). */
export interface QuestionContent {
  question: string
  options: string[]
  correct_index: number
}

/** Content of an explanation slide. */
export interface ExplanationContent {
  explanation: string
}

export interface LessonSlide {
  id: string
  order: number
  type: 'question' | 'explanation'
  content: Record<string, unknown>
}

export interface LessonDetail {
  id: string
  title: string
  status: 'draft' | 'published'
  sourcePresentationId: number | null
  estimatedDurationMinutes: number | null
  language: string | null
  reviewed: boolean
  createdAt: string
  updatedAt: string
}

export interface LessonDetailResponse {
  lesson: LessonDetail
  slides: LessonSlide[]
}

/** GET one normalized lesson + its ordered slides. */
export async function fetchLessonDetail(id: string): Promise<LessonDetailResponse> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}`)
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Save edits: title, duration, and/or per-slide content. */
export async function saveLessonDetail(
  id: string,
  patch: {
    title?: string
    estimatedDurationMinutes?: number | null
    slides?: Array<{ id: string; content: Record<string, unknown> }>
  },
): Promise<LessonDetailResponse> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Reorder Q+E pairs by the new sequence of question slide ids. */
export async function reorderLesson(
  id: string,
  questionOrder: string[],
): Promise<LessonDetailResponse> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/reorder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: questionOrder }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Delete the question (at `order`) + its paired explanation. Enforces min 3. */
export async function deleteQuestionPair(
  id: string,
  order: number,
): Promise<LessonDetailResponse> {
  const res = await fetch(
    `/api/courses/lessons/${encodeURIComponent(id)}/questions/${order}`,
    { method: 'DELETE' },
  )
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Regenerate just ONE Q+E pair from the source presentation. */
export async function regenerateQuestion(
  id: string,
  order: number,
): Promise<LessonDetailResponse> {
  const res = await fetch(
    `/api/courses/lessons/${encodeURIComponent(id)}/questions/${order}/regenerate`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Regenerate the WHOLE lesson from the source presentation (edits are lost). */
export async function regenerateLesson(id: string): Promise<LessonDetailResponse> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}

/** Mark the lesson as reviewed (called on first page open; gates publish). */
export async function markLessonReviewed(id: string): Promise<LessonDetailResponse> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/reviewed`, {
    method: 'POST',
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonDetailResponse>
}
