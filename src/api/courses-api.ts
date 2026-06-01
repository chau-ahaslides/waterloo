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

// ── Lesson publishing (WAT-12 / Stage 4) ────────────────────────────────────

/** How learners identify themselves on the public link. */
export type AuthMode = 'anonymous' | 'name' | 'email'

/** The publishing surface the lesson-detail page renders + acts on. */
export interface PublishState {
  id: string
  /** 'draft' (never published / unpublished-to-draft) | 'published' | 'unpublished'. */
  status: 'draft' | 'published' | 'unpublished'
  reviewed: boolean
  authMode: AuthMode
  /** Stable public slug; null until first publish. */
  shareLinkSlug: string | null
  /** ISO-8601 of the last publish / update-published; null until first publish. */
  publishedAt: string | null
  /** True when published AND the draft has unpromoted edits. */
  hasDraftChanges: boolean
}

interface PublishStateResponse {
  publishState: PublishState
}

/** GET the lesson's publishing state (slug, auth mode, status, draft-changes). */
export async function fetchPublishState(id: string): Promise<PublishState> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/publish-state`)
  if (!res.ok) await parseError(res)
  return ((await res.json()) as PublishStateResponse).publishState
}

/** Set the auth mode (before publishing). */
export async function setLessonAuthMode(id: string, authMode: AuthMode): Promise<PublishState> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/auth-mode`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authMode }),
  })
  if (!res.ok) await parseError(res)
  return ((await res.json()) as PublishStateResponse).publishState
}

/** Publish the lesson (gated server-side on reviewed). Generates the slug once. */
export async function publishLesson(id: string, authMode?: AuthMode): Promise<PublishState> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(authMode ? { authMode } : {}),
  })
  if (!res.ok) await parseError(res)
  return ((await res.json()) as PublishStateResponse).publishState
}

/** Promote the current draft to the live published version (slug unchanged). */
export async function updatePublishedLesson(id: string): Promise<PublishState> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/update-published`, {
    method: 'POST',
  })
  if (!res.ok) await parseError(res)
  return ((await res.json()) as PublishStateResponse).publishState
}

/** Take the lesson offline (the public link then shows "not available"). */
export async function unpublishLesson(id: string): Promise<PublishState> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
  })
  if (!res.ok) await parseError(res)
  return ((await res.json()) as PublishStateResponse).publishState
}

// ── Public learner resolve (WAT-12; player is Stage 5) ──────────────────────

/** One published slide (the snapshot shape served by GET /api/learn/:slug). */
export interface PublishedSlide {
  order: number
  type: 'question' | 'explanation'
  content: Record<string, unknown>
}

export interface PublishedLesson {
  id: string
  title: string
  description: string
  estimatedDurationMinutes: number | null
  authMode: AuthMode
  slides: PublishedSlide[]
}

export type LearnResolveResult =
  | { available: true; lesson: PublishedLesson }
  | { available: false; error: string }

/** PUBLIC: resolve a share-link slug to its live published lesson (or not-available). */
export async function fetchPublishedBySlug(slug: string): Promise<LearnResolveResult> {
  const res = await fetch(`/api/learn/${encodeURIComponent(slug)}`)
  const body = (await res.json().catch(() => ({}))) as Partial<LearnResolveResult> & {
    error?: string
  }
  if (res.ok && body.available) {
    return body as LearnResolveResult
  }
  return { available: false, error: body.error ?? 'This lesson is not available.' }
}

// ── PUBLIC learner persistence (WAT-13 / Stage 5) ───────────────────────────
//
// Anonymous learners persist in localStorage (no network). Name/Email learners
// persist server-side via these three endpoints, keyed by the learner id the
// start call returns.

export interface LearnerStart {
  learnerId: string
  currentSlideOrder: number
  completedAt: string | null
}

/** Create-or-resume a server-side learner for a name/email lesson. */
export async function startLearner(slug: string, identifier: string): Promise<LearnerStart> {
  const res = await fetch(`/api/learn/${encodeURIComponent(slug)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LearnerStart>
}

/** Upsert a learner's current slide / completion. Best-effort (fire-and-forget OK). */
export async function saveLearnerProgress(
  slug: string,
  learnerId: string,
  currentSlideOrder: number,
  completed = false,
): Promise<void> {
  const res = await fetch(`/api/learn/${encodeURIComponent(slug)}/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ learnerId, currentSlideOrder, completed }),
  })
  if (!res.ok) await parseError(res)
}

/** Record one answer for a server-side learner. */
export async function recordLearnerResponse(
  slug: string,
  learnerId: string,
  slideOrder: number,
  value: unknown,
): Promise<void> {
  const res = await fetch(`/api/learn/${encodeURIComponent(slug)}/response`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ learnerId, slideOrder, value }),
  })
  if (!res.ok) await parseError(res)
}

// ── Courses (container of lessons) — WAT-14 / Stage 6 ───────────────────────

/** How lessons are navigated within a course. */
export type OrderMode = 'free' | 'sequential'

/** A course summary (the Courses tab list). */
export interface CourseSummary {
  id: string
  title: string
  description: string
  authMode: AuthMode
  orderMode: OrderMode
  status: 'draft' | 'published' | 'unpublished'
  shareLinkSlug: string | null
  lessonCount: number
  totalDurationMinutes: number
  createdAt: string
  updatedAt: string
}

/** A member lesson within a course (trainer detail view). */
export interface CourseMemberLesson {
  courseLessonId: string
  order: number
  lessonId: string
  title: string
  status: 'draft' | 'published' | 'unpublished'
  shareLinkSlug: string | null
  estimatedDurationMinutes: number | null
  slideCount: number
}

export interface CourseDetail {
  id: string
  title: string
  description: string
  authMode: AuthMode
  orderMode: OrderMode
  status: 'draft' | 'published' | 'unpublished'
  shareLinkSlug: string | null
  publishedAt: string | null
  lessonCount: number
  totalDurationMinutes: number
  createdAt: string
  updatedAt: string
}

export interface CourseDetailResponse {
  course: CourseDetail
  lessons: CourseMemberLesson[]
}

/** List all courses, newest first. */
export async function fetchCourses(): Promise<CourseSummary[]> {
  const res = await fetch('/api/courses')
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as { courses: CourseSummary[] }
  return body.courses ?? []
}

/** Create a DRAFT course with an ordered set of member lessons. */
export async function createCourse(input: {
  title: string
  description?: string
  orderMode?: OrderMode
  authMode?: AuthMode
  lessonIds?: string[]
}): Promise<CourseDetailResponse> {
  const res = await fetch('/api/courses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** GET one course + its ordered member lessons. */
export async function fetchCourseDetail(id: string): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}`)
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Edit course title/description/orderMode/authMode (any subset). */
export async function patchCourse(
  id: string,
  patch: { title?: string; description?: string; orderMode?: OrderMode; authMode?: AuthMode },
): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Delete a course (and its membership). */
export async function deleteCourse(id: string): Promise<void> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) await parseError(res)
}

/** Add a lesson to a course (one-course-per-lesson; 409 if owned elsewhere). */
export async function addCourseLesson(id: string, lessonId: string): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/lessons`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Remove a lesson from a course. */
export async function removeCourseLesson(
  id: string,
  lessonId: string,
): Promise<CourseDetailResponse> {
  const res = await fetch(
    `/api/courses/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lessonId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Reorder member lessons by the new sequence of lesson ids. */
export async function reorderCourse(
  id: string,
  lessonOrder: string[],
): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/reorder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: lessonOrder }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Publish the course — mint a stable slug + snapshot the published members. */
export async function publishCourse(id: string): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/publish`, { method: 'POST' })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

/** Take the course offline (slug retained). */
export async function unpublishCourse(id: string): Promise<CourseDetailResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/unpublish`, { method: 'POST' })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseDetailResponse>
}

// ── PUBLIC course learner (the /learn/c/:slug experience) ───────────────────

export interface PublicCourseLesson {
  lessonId: string
  slug: string
  title: string
  order: number
  estimatedDurationMinutes: number | null
}

export interface PublicCourse {
  id: string
  title: string
  description: string
  authMode: AuthMode
  orderMode: OrderMode
  totalDurationMinutes: number
  lessons: PublicCourseLesson[]
}

export type CourseResolveResult =
  | { available: true; course: PublicCourse; completedLessonIds: string[] }
  | { available: false; error: string }

/** PUBLIC: resolve a course share-link slug to its live published course. */
export async function fetchCourseBySlug(
  slug: string,
  learnerId?: string,
): Promise<CourseResolveResult> {
  const qs = learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''
  const res = await fetch(`/api/learn/c/${encodeURIComponent(slug)}${qs}`)
  const body = (await res.json().catch(() => ({}))) as Partial<CourseResolveResult> & {
    error?: string
  }
  if (res.ok && body.available) return body as CourseResolveResult
  return { available: false, error: body.error ?? 'This course is not available.' }
}

export interface CourseLearnerStart {
  learnerId: string
  completedLessonIds: string[]
}

/** Create-or-resume a course learner (name/email courses). */
export async function startCourseLearner(
  slug: string,
  identifier: string,
): Promise<CourseLearnerStart> {
  const res = await fetch(`/api/learn/c/${encodeURIComponent(slug)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseLearnerStart>
}

export interface CourseProgressResult {
  ok: boolean
  completedLessonIds: string[]
  courseComplete: boolean
}

/** Mark one member lesson complete for a course learner. */
export async function saveCourseLessonProgress(
  slug: string,
  learnerId: string,
  lessonId: string,
  completed: boolean,
): Promise<CourseProgressResult> {
  const res = await fetch(`/api/learn/c/${encodeURIComponent(slug)}/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ learnerId, lessonId, completed }),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseProgressResult>
}

// ── OWNER analytics / dashboards (WAT-15 / Stage 7) ─────────────────────────
//
// Owner-only progress dashboards over the Courses learner tables. Distinct from
// the legacy audience Report (/lesson/:id/report), which reads the `attempts`
// table — a different data model. These are never exposed on /learn routes.

/** One question's response distribution in a lesson dashboard. */
export interface QuestionAnalytics {
  order: number
  question: string
  options: { index: number; label: string; count: number; isCorrect: boolean }[]
  totalResponses: number
  correctCount: number
  correctRate: number
  mostMissed: boolean
}

/** One learner row in the per-learner list (identified lessons only). */
export interface LearnerAnalyticsRow {
  identifier: string | null
  status: 'joined' | 'in-progress' | 'completed'
  currentSlideOrder: number
  startedAt: string
  completedAt: string | null
}

export interface LessonAnalytics {
  lesson: {
    id: string
    title: string
    status: 'draft' | 'published'
    authMode: AuthMode
    estimatedDurationMinutes: number | null
  }
  /** anonymous lessons → aggregate only; `learners` is null. */
  anonymous: boolean
  stats: {
    joined: number
    completed: number
    completionRate: number
    avgTimeToCompleteSeconds: number | null
    estimatedDurationMinutes: number | null
  }
  learners: LearnerAnalyticsRow[] | null
  questions: QuestionAnalytics[]
}

/** GET owner lesson dashboard analytics. */
export async function fetchLessonAnalytics(id: string): Promise<LessonAnalytics> {
  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(id)}/analytics`)
  if (!res.ok) await parseError(res)
  return res.json() as Promise<LessonAnalytics>
}

export interface CourseLessonBreakdown {
  lessonId: string
  title: string
  order: number
  estimatedDurationMinutes: number | null
  started: number
  completed: number
  dropOff: number
  completionRate: number
}

export interface CourseAnalytics {
  course: {
    id: string
    title: string
    status: 'draft' | 'published' | 'unpublished'
    authMode: AuthMode
  }
  anonymous: boolean
  stats: {
    joined: number
    completed: number
    completionRate: number
    avgTimeToCompleteSeconds: number | null
  }
  lessons: CourseLessonBreakdown[]
}

/** GET owner course dashboard analytics. */
export async function fetchCourseAnalytics(id: string): Promise<CourseAnalytics> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/analytics`)
  if (!res.ok) await parseError(res)
  return res.json() as Promise<CourseAnalytics>
}
