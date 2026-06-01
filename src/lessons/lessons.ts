// Lessons data model + localStorage persistence.
//
// There is no backend lessons API yet, so lessons are persisted in
// localStorage under a namespaced key. A lesson is derived from ONE
// presentation and (for now) contains only its "pick answer" slides
// (multiple-choice quiz slides). See src/api/slides.ts for how the slide
// content is fetched and which slides qualify.

import {
  fetchPickAnswerSlides,
  type RawSlide,
  type RawSlideOption,
} from '@/api/slides'

const STORAGE_KEY = 'waterloo.lessons'

/** One answer option of a lesson slide. */
export interface LessonOption {
  id: number
  text: string
  isCorrect: boolean
  image?: string | null
}

/** One "pick answer" slide captured into a lesson. */
export interface LessonSlide {
  id: number
  question: string
  options: LessonOption[]
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

/** Map a raw "pick answer" slide into a lesson slide. */
function toLessonSlide(slide: RawSlide): LessonSlide {
  const options = (slide.SlideOptions ?? []).map(
    (o: RawSlideOption): LessonOption => ({
      id: o.id,
      text: (o.title ?? '').trim(),
      isCorrect: Boolean(o.correct),
      image: o.image ?? null,
    }),
  )
  return {
    id: slide.id,
    question: (slide.title ?? '').trim() || 'Untitled question',
    options,
  }
}

/**
 * Convert ONE presentation into ONE lesson, pulling only its "pick answer"
 * slides. Returns null if the presentation has no pick-answer slides (so the
 * caller can skip empty conversions and report them).
 */
export async function convertPresentationToLesson(
  presentationId: number,
  presentationName: string,
): Promise<Lesson | null> {
  const slides = await fetchPickAnswerSlides(presentationId)
  if (!slides.length) return null
  return {
    id: newLessonId(),
    presentationId,
    title: presentationName?.trim() || `Presentation ${presentationId}`,
    createdAt: new Date().toISOString(),
    slides: slides.map(toLessonSlide),
  }
}
