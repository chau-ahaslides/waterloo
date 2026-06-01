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
// ---------------------------------------------------------------------------
describe('convertPresentationToLesson', () => {
  const pickAnswerSlide: RawSlide = {
    id: 1,
    type: 'pickAnswer',
    slideType: null,
    title: 'What is 2+2?',
    order: 1,
    SlideOptions: [
      { id: 10, title: '3', correct: false, order: 1 },
      { id: 11, title: '4', correct: true, order: 2 },
    ],
  }

  it('returns null when there are no pick-answer slides', async () => {
    vi.spyOn(slidesApi, 'fetchPickAnswerSlides').mockResolvedValueOnce([])
    const result = await convertPresentationToLesson(99, 'Empty Pres')
    expect(result).toBeNull()
  })

  it('converts slides into a Lesson with correct structure', async () => {
    vi.spyOn(slidesApi, 'fetchPickAnswerSlides').mockResolvedValueOnce([pickAnswerSlide])
    const lesson = await convertPresentationToLesson(42, 'My Quiz')
    expect(lesson).not.toBeNull()
    expect(lesson!.presentationId).toBe(42)
    expect(lesson!.title).toBe('My Quiz')
    expect(lesson!.slides).toHaveLength(1)
    const slide = lesson!.slides[0]
    expect(slide.question).toBe('What is 2+2?')
    expect(slide.options).toHaveLength(2)
    expect(slide.options.find((o) => o.isCorrect)?.text).toBe('4')
  })

  it('falls back to "Untitled question" when slide title is empty', async () => {
    const noTitle: RawSlide = { ...pickAnswerSlide, title: '' }
    vi.spyOn(slidesApi, 'fetchPickAnswerSlides').mockResolvedValueOnce([noTitle])
    const lesson = await convertPresentationToLesson(42, 'Pres')
    expect(lesson!.slides[0].question).toBe('Untitled question')
  })
})
