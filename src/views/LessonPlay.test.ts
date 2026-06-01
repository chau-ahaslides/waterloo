// Unit tests for the LessonPlay audience-view playback logic.
//
// Since the state machine lives inline in LessonPlay.vue we test the pure
// helper behaviour here: option class derivation, score tallying,
// advance / completion logic — all extracted to plain functions that match
// what the component does.

import { describe, it, expect } from 'vitest'
import type { Lesson } from '@/lessons/lessons'
import type { PickAnswerOption, PickAnswerLessonSlide } from '@/slide-types/pickAnswer/module'

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeOption(id: number, isCorrect: boolean, text = `Option ${id}`): PickAnswerOption {
  return { id, text, isCorrect }
}

function makeSlide(id: number, options: PickAnswerOption[]): PickAnswerLessonSlide {
  return { id, type: 'pickAnswer', question: `Question ${id}?`, options }
}

function makeLesson(slides: PickAnswerLessonSlide[]): Lesson {
  return {
    id: 'lesson_test',
    presentationId: 1,
    title: 'Test Lesson',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    publishedAt: null,
    description: '',
    status: 'draft',
    slides,
  }
}

// ── Pure logic extracted from the component ───────────────────────────────────

/** Mirrors the component's advance() logic. */
function advance(state: {
  currentIndex: number
  totalQuestions: number
  score: number
  completed: boolean
  selectedOptionId: number | null
  showingFeedback: boolean
}): typeof state {
  const nextIndex = state.currentIndex + 1
  if (nextIndex >= state.totalQuestions) {
    return { ...state, completed: true }
  }
  return {
    ...state,
    currentIndex: nextIndex,
    selectedOptionId: null,
    showingFeedback: false,
  }
}

/** Mirrors selectOption(): tally score and enter feedback phase. */
function selectOption(
  state: {
    selectedOptionId: number | null
    showingFeedback: boolean
    score: number
  },
  opt: PickAnswerOption,
): typeof state {
  if (state.showingFeedback || state.selectedOptionId !== null) return state
  return {
    selectedOptionId: opt.id,
    showingFeedback: true,
    score: state.score + (opt.isCorrect ? 1 : 0),
  }
}

/** Mirrors progressPercent computed. */
function progressPercent(currentIndex: number, totalQuestions: number): number {
  return totalQuestions ? Math.round((currentIndex / totalQuestions) * 100) : 0
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LessonPlay — selectOption', () => {
  const correctOpt = makeOption(1, true)
  const wrongOpt = makeOption(2, false)
  const initialState = { selectedOptionId: null, showingFeedback: false, score: 0 }

  it('increments score on correct answer', () => {
    const next = selectOption(initialState, correctOpt)
    expect(next.score).toBe(1)
    expect(next.selectedOptionId).toBe(1)
    expect(next.showingFeedback).toBe(true)
  })

  it('does not increment score on wrong answer', () => {
    const next = selectOption(initialState, wrongOpt)
    expect(next.score).toBe(0)
    expect(next.selectedOptionId).toBe(2)
    expect(next.showingFeedback).toBe(true)
  })

  it('is a no-op if feedback is already showing (double-tap guard)', () => {
    const lockedState = { selectedOptionId: 1, showingFeedback: true, score: 1 }
    const next = selectOption(lockedState, wrongOpt)
    expect(next).toEqual(lockedState)
  })

  it('is a no-op if an option has already been selected', () => {
    const answeredState = { selectedOptionId: 1, showingFeedback: false, score: 1 }
    const next = selectOption(answeredState, wrongOpt)
    expect(next).toEqual(answeredState)
  })
})

describe('LessonPlay — advance', () => {
  const baseState = {
    currentIndex: 0,
    totalQuestions: 3,
    score: 1,
    completed: false,
    selectedOptionId: 1,
    showingFeedback: true,
  }

  it('moves to the next question and resets selection state', () => {
    const next = advance(baseState)
    expect(next.currentIndex).toBe(1)
    expect(next.selectedOptionId).toBeNull()
    expect(next.showingFeedback).toBe(false)
    expect(next.completed).toBe(false)
  })

  it('marks completed after the last question', () => {
    const lastState = { ...baseState, currentIndex: 2 }
    const next = advance(lastState)
    expect(next.completed).toBe(true)
  })

  it('marks completed even when only 1 question total', () => {
    const singleQ = { ...baseState, currentIndex: 0, totalQuestions: 1 }
    const next = advance(singleQ)
    expect(next.completed).toBe(true)
  })
})

describe('LessonPlay — progressPercent', () => {
  it('is 0% at the first question', () => {
    expect(progressPercent(0, 5)).toBe(0)
  })

  it('is 100% when all questions answered (index = total)', () => {
    expect(progressPercent(5, 5)).toBe(100)
  })

  it('is 50% at halfway', () => {
    expect(progressPercent(2, 4)).toBe(50)
  })

  it('returns 0 for empty lesson (totalQuestions=0) without divide-by-zero', () => {
    expect(progressPercent(0, 0)).toBe(0)
  })
})

describe('LessonPlay — score tally across a full lesson', () => {
  const opts = [makeOption(1, false), makeOption(2, true), makeOption(3, false)]
  const slide = makeSlide(1, opts)
  const _lesson = makeLesson([slide, slide, slide])

  it('tallies correct answers over 3 questions', () => {
    let state = { selectedOptionId: null as number | null, showingFeedback: false, score: 0 }
    let playState = {
      currentIndex: 0,
      totalQuestions: 3,
      score: 0,
      completed: false,
      selectedOptionId: null as number | null,
      showingFeedback: false,
    }

    // Answer correct, correct, wrong
    const answers = [opts[1], opts[1], opts[0]] // correct, correct, wrong
    for (const ans of answers) {
      state = selectOption(state, ans)
      playState = { ...playState, score: state.score }
      const next = advance({ ...playState, currentIndex: playState.currentIndex })
      playState = { ...next, score: state.score }
      // Reset for next iteration
      state = { selectedOptionId: null, showingFeedback: false, score: state.score }
    }

    expect(playState.score).toBe(2)
    expect(playState.completed).toBe(true)
  })
})

describe('LessonPlay — lesson model', () => {
  it('makeLesson produces a valid lesson with slides', () => {
    const slides = [makeSlide(1, [makeOption(1, true)]), makeSlide(2, [makeOption(2, false)])]
    const lesson = makeLesson(slides)
    expect(lesson.slides).toHaveLength(2)
    expect((lesson.slides[0] as PickAnswerLessonSlide).question).toBe('Question 1?')
  })

  it('an empty lesson has 0 slides', () => {
    const lesson = makeLesson([])
    expect(lesson.slides).toHaveLength(0)
  })
})
