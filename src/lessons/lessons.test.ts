import { describe, it, expect, vi } from 'vitest'
import { convertPresentationToLesson, newLessonId } from './lessons'
import * as slidesApi from '@/api/slides'
import type { RawSlide } from '@/api/slides'
import type { PickAnswerLessonSlide } from '@/slide-types/pickAnswer/module'
import type { InfoLessonSlide } from '@/slide-types/infoSlide/module'

// ---------------------------------------------------------------------------
// newLessonId — unique, prefixed ids
// ---------------------------------------------------------------------------
describe('newLessonId', () => {
  it('returns a lesson_-prefixed, unique id', () => {
    const a = newLessonId()
    const b = newLessonId()
    expect(a.startsWith('lesson_')).toBe(true)
    expect(a).not.toBe(b)
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
    // New lessons are drafts with the full model fields populated.
    expect(lesson!.status).toBe('draft')
    expect(lesson!.description).toBe('')
    expect(lesson!.publishedAt).toBeNull()
    expect(lesson!.updatedAt).toBe(lesson!.createdAt)
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
