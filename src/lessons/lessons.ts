// Lessons data model + conversion.
//
// Lessons are persisted SERVER-SIDE in D1 via the lessons API (src/api/
// lessons-api.ts) — see WAT-3. This module owns the shared data MODEL and the
// pure presentation→lesson CONVERSION; it no longer persists anything itself.
// A lesson is derived from ONE presentation: every slide whose presenter shape
// is claimed by a registered slide-type module becomes a lesson slide;
// everything else is skipped.
//
// Conversion + the lesson-slide shapes themselves live in the pluggable
// slide-type registry (src/slide-types/). This module is GENERIC — it never
// references a concrete slide type for conversion. To support a new presenter
// slide type, register a module in src/slide-types/registry.ts.

import { fetchPresentationSlides } from '@/api/slides'
import { convertRawSlide } from '@/slide-types/registry'
import type { BaseLessonSlide } from '@/slide-types/types'
import type {
  PickAnswerLessonSlide,
  PickAnswerOption,
} from '@/slide-types/pickAnswer/module'
import type { InfoLessonSlide } from '@/slide-types/infoSlide/module'
import type { TextLessonSlide } from '@/slide-types/text/module'
import type { HtmlLessonSlide } from '@/slide-types/html/module'
import type { YoutubeLessonSlide } from '@/slide-types/youtube/module'

// Re-export the concrete slide-type shapes so existing imports keep working.
export type {
  PickAnswerLessonSlide,
  PickAnswerOption,
  InfoLessonSlide,
  TextLessonSlide,
  HtmlLessonSlide,
  YoutubeLessonSlide,
}

/**
 * A lesson slide of any registered type — a discriminated union over the
 * concrete per-type shapes. New slide types add a member here (one line); the
 * `BaseLessonSlide` fallback keeps deserialised unknown types representable.
 */
export type LessonSlide =
  | PickAnswerLessonSlide
  | InfoLessonSlide
  | TextLessonSlide
  | HtmlLessonSlide
  | YoutubeLessonSlide
  | BaseLessonSlide

/**
 * @deprecated kept for back-compat. A pick-answer option. Prefer importing
 * `PickAnswerOption` from the slide-type module.
 */
export interface LessonOption {
  id: number
  text: string
  isCorrect: boolean
  image?: string | null
}

/** Lesson lifecycle status. */
export type LessonStatus = 'draft' | 'published'

/** A lesson derived from a single presentation (or hand-authored). */
export interface Lesson {
  id: string
  presentationId: number
  title: string
  description: string
  slides: LessonSlide[]
  status: LessonStatus
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export function newLessonId(): string {
  // Prefer crypto.randomUUID where available; fall back to a timestamp+random.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `lesson_${crypto.randomUUID()}`
  }
  return `lesson_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Convert ONE presentation into ONE lesson. Fetches all slides in display
 * order, runs each through the slide-type registry, and keeps the ones a
 * registered module claims (pick-answer, info, …). Unsupported slides are
 * skipped. Returns null if NO slide converts (so the caller can report it).
 */
export async function convertPresentationToLesson(
  presentationId: number,
  presentationName: string,
): Promise<Lesson | null> {
  const raw = await fetchPresentationSlides(presentationId)
  const ordered = [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const slides = ordered
    .map((s) => convertRawSlide(s))
    .filter((s): s is LessonSlide => s !== null)

  if (!slides.length) return null
  const now = new Date().toISOString()
  return {
    id: newLessonId(),
    presentationId,
    title: presentationName?.trim() || `Presentation ${presentationId}`,
    description: '',
    slides,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  }
}
