import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadLessons,
  saveLessons,
  addLessons,
  deleteLesson,
  convertPresentationToLesson,
  type Lesson,
} from './lessons'
import * as slidesApi from '@/api/slides'
import type { RawSlide } from '@/api/slides'
import type { PickAnswerLessonSlide } from '@/slide-types/pickAnswer/module'
import type { InfoLessonSlide } from '@/slide-types/infoSlide/module'

// ---------------------------------------------------------------------------
// localStorage stub — jsdom provides one but reset it between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'lesson_test_1',
    presentationId: 42,
    title: 'Test Lesson',
    createdAt: '2026-06-01T00:00:00.000Z',
    slides: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// loadLessons
// ---------------------------------------------------------------------------
describe('loadLessons', () => {
  it('returns [] when localStorage is empty', () => {
    expect(loadLessons()).toEqual([])
  })

  it('returns parsed lessons when data is valid JSON', () => {
    const lesson = makeLesson()
    localStorage.setItem('waterloo.lessons', JSON.stringify([lesson]))
    expect(loadLessons()).toEqual([lesson])
  })

  it('returns [] on corrupt JSON (tolerant)', () => {
    localStorage.setItem('waterloo.lessons', 'not-json}}}')
    expect(loadLessons()).toEqual([])
  })

  it('returns [] when stored value is not an array', () => {
    localStorage.setItem('waterloo.lessons', JSON.stringify({ lessons: [] }))
    expect(loadLessons()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// saveLessons / loadLessons round-trip
// ---------------------------------------------------------------------------
describe('saveLessons', () => {
  it('persists a list and loadLessons retrieves it', () => {
    const lessons = [makeLesson({ id: 'a' }), makeLesson({ id: 'b' })]
    saveLessons(lessons)
    expect(loadLessons()).toEqual(lessons)
  })
})

// ---------------------------------------------------------------------------
// addLessons
// ---------------------------------------------------------------------------
describe('addLessons', () => {
  it('prepends new lessons (newest-first)', () => {
    const existing = makeLesson({ id: 'old' })
    saveLessons([existing])

    const added = addLessons([makeLesson({ id: 'new' })])
    expect(added[0].id).toBe('new')
    expect(added[1].id).toBe('old')
    expect(loadLessons()).toHaveLength(2)
  })

  it('returns the full updated list', () => {
    const result = addLessons([makeLesson({ id: 'x' })])
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// deleteLesson
// ---------------------------------------------------------------------------
describe('deleteLesson', () => {
  it('removes the lesson with the matching id', () => {
    saveLessons([makeLesson({ id: 'keep' }), makeLesson({ id: 'remove' })])
    const remaining = deleteLesson('remove')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('keep')
  })

  it('is a no-op when the id does not exist', () => {
    saveLessons([makeLesson({ id: 'keep' })])
    const remaining = deleteLesson('nonexistent')
    expect(remaining).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// convertPresentationToLesson — unit (fetch mocked via vi.spyOn)
//
// The converter is now GENERIC: it fetches ALL presentation slides and runs
// each through the slide-type registry. We mock fetchPresentationSlides and
// assert the registry routes pick-answer + info (freestyle) slides correctly
// and skips unsupported slides.
// ---------------------------------------------------------------------------
describe('convertPresentationToLesson', () => {
  const pickAnswerSlide: RawSlide = {
    id: 1,
    type: 'pickAnswer',
    slideType: null,
    title: 'What is 2+2?',
    order: 2,
    SlideOptions: [
      { id: 10, title: '3', correct: false, order: 1 },
      { id: 11, title: '4', correct: true, order: 2 },
    ],
  }
  const infoSlide: RawSlide = {
    id: 2,
    type: 'freestyle',
    slideType: null,
    title: 'Historic Landmarks',
    order: 1,
  }
  const unsupportedSlide: RawSlide = {
    id: 3,
    type: 'wordCloud',
    slideType: null,
    title: 'Ignore me',
    order: 3,
  }

  it('returns null when no slide converts (all unsupported)', async () => {
    vi.spyOn(slidesApi, 'fetchPresentationSlides').mockResolvedValueOnce([unsupportedSlide])
    const result = await convertPresentationToLesson(99, 'Empty Pres')
    expect(result).toBeNull()
  })

  it('converts supported slides into a Lesson, in display order, skipping the rest', async () => {
    vi.spyOn(slidesApi, 'fetchPresentationSlides').mockResolvedValueOnce([
      pickAnswerSlide,
      infoSlide,
      unsupportedSlide,
    ])
    const lesson = await convertPresentationToLesson(42, 'My Quiz')
    expect(lesson).not.toBeNull()
    expect(lesson!.presentationId).toBe(42)
    expect(lesson!.title).toBe('My Quiz')
    // info (order 1) then pick-answer (order 2); unsupported skipped.
    expect(lesson!.slides.map((s) => s.type)).toEqual(['infoSlide', 'pickAnswer'])

    const info = lesson!.slides[0] as unknown as InfoLessonSlide
    expect(info.title).toBe('Historic Landmarks')

    const pa = lesson!.slides[1] as unknown as PickAnswerLessonSlide
    expect(pa.question).toBe('What is 2+2?')
    expect(pa.options).toHaveLength(2)
    expect(pa.options.find((o) => o.isCorrect)?.text).toBe('4')
  })

  it('falls back to "Untitled question" when a pick-answer slide title is empty', async () => {
    const noTitle: RawSlide = { ...pickAnswerSlide, title: '' }
    vi.spyOn(slidesApi, 'fetchPresentationSlides').mockResolvedValueOnce([noTitle])
    const lesson = await convertPresentationToLesson(42, 'Pres')
    expect((lesson!.slides[0] as unknown as PickAnswerLessonSlide).question).toBe('Untitled question')
  })
})
