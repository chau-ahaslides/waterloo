// Lessons data model + localStorage persistence.
//
// There is no backend lessons API yet, so lessons are persisted in
// localStorage under a namespaced key. A lesson is derived from ONE
// presentation: every slide whose presenter shape is claimed by a registered
// slide-type module becomes a lesson slide; everything else is skipped.
//
// Conversion + the lesson-slide shapes themselves live in the pluggable
// slide-type registry (src/slide-types/). This module is GENERIC — it never
// references a concrete slide type. To support a new presenter slide type,
// register a module in src/slide-types/registry.ts; nothing here changes.

import { fetchPresentationSlides } from '@/api/slides'
import { convertRawSlide } from '@/slide-types/registry'
import type { BaseLessonSlide } from '@/slide-types/types'
import type {
  PickAnswerLessonSlide,
  PickAnswerOption,
} from '@/slide-types/pickAnswer/module'
import type { InfoLessonSlide } from '@/slide-types/infoSlide/module'

// Re-export the concrete slide-type shapes so existing imports keep working.
export type { PickAnswerLessonSlide, PickAnswerOption, InfoLessonSlide }

const STORAGE_KEY = 'waterloo.lessons'

/**
 * A lesson slide of any registered type — a discriminated union over the
 * concrete per-type shapes. New slide types add a member here (one line); the
 * `BaseLessonSlide` fallback keeps deserialised unknown types representable.
 */
export type LessonSlide =
  | PickAnswerLessonSlide
  | InfoLessonSlide
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

/** A lesson derived from a single presentation. */
export interface Lesson {
  id: string
  presentationId: number
  title: string
  createdAt: string
  slides: LessonSlide[]
}

/** Read all stored lessons (most-recent first). Tolerant of corrupt data. */
export function loadLessons(): Lesson[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Lesson[]
  } catch {
    return []
  }
}

/** Persist the full lessons list. */
export function saveLessons(lessons: Lesson[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons))
}

/** Append lessons to storage (newest first) and return the new full list. */
export function addLessons(newLessons: Lesson[]): Lesson[] {
  const all = [...newLessons, ...loadLessons()]
  saveLessons(all)
  return all
}

/** Delete one lesson by id and return the new full list. */
export function deleteLesson(id: string): Lesson[] {
  const all = loadLessons().filter((l) => l.id !== id)
  saveLessons(all)
  return all
}

function newLessonId(): string {
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
  return {
    id: newLessonId(),
    presentationId,
    title: presentationName?.trim() || `Presentation ${presentationId}`,
    createdAt: new Date().toISOString(),
    slides,
  }
}
