// Component/interaction tests for LessonPlay.vue (audience playback view).
//
// MOUNT the view, MOCK the lessons store + router, then drive the real UI:
// render a question, click an answer, let the 800ms auto-advance fire (fake
// timers), and confirm the completion screen + final score render. This is the
// UI-interaction complement to the pure-logic tests in LessonPlay.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Lesson } from '@/lessons/lessons'

// --- Mock the lessons API ---------------------------------------------------
const fetchLesson = vi.fn()
vi.mock('@/api/lessons-api', () => ({
  fetchLesson: (id: string) => fetchLesson(id),
}))

// --- Mock the router --------------------------------------------------------
const push = vi.fn()
let routeId = 'l1'
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: routeId }, query: { token: 'abc' } }),
  useRouter: () => ({ push }),
}))

import LessonPlay from './LessonPlay.vue'

function twoQuestionLesson(): Lesson {
  return {
    id: 'l1',
    presentationId: 5,
    title: 'Geography Quiz',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    publishedAt: null,
    description: '',
    status: 'draft',
    slides: [
      {
        id: 1,
        type: 'pickAnswer',
        question: 'Capital of France?',
        options: [
          { id: 11, text: 'Paris', isCorrect: true },
          { id: 12, text: 'Berlin', isCorrect: false },
        ],
      },
      {
        id: 2,
        type: 'pickAnswer',
        question: 'Capital of Japan?',
        options: [
          { id: 21, text: 'Seoul', isCorrect: false },
          { id: 22, text: 'Tokyo', isCorrect: true },
        ],
      },
    ],
  }
}

function mountPlay() {
  return mount(LessonPlay, { global: { plugins: [Antd] } })
}

/** Find a rendered answer-option button by its label text. */
function optionButton(wrapper: ReturnType<typeof mountPlay>, label: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(label))
}

beforeEach(() => {
  vi.clearAllMocks()
  routeId = 'l1'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LessonPlay.vue', () => {
  it('renders the first question and its options', async () => {
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Geography Quiz')
    expect(text).toContain('Capital of France?')
    expect(text).toContain('Paris')
    expect(text).toContain('Berlin')
    expect(text).toContain('1 / 2')
  })

  it('shows the "not found" screen for an unknown lesson id', async () => {
    routeId = 'does-not-exist'
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    expect(wrapper.text()).toContain('Lesson not found')
  })

  it('selecting a correct answer tallies the score and auto-advances to the next question', async () => {
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    await optionButton(wrapper, 'Paris')!.trigger('click')
    await flushPromises()

    // Immediate feedback before the timer fires.
    expect(wrapper.text()).toContain('Correct!')

    // Advance the 800ms auto-advance timer.
    vi.advanceTimersByTime(800)
    await flushPromises()

    // Now on question 2.
    expect(wrapper.text()).toContain('Capital of Japan?')
    expect(wrapper.text()).toContain('2 / 2')
    // Score badge shows 1 correct out of 1 answered.
    expect(wrapper.text()).toContain('1 / 1 correct')
  })

  it('score badge denominator counts the current slide during its feedback window (no "1 / 0")', async () => {
    // Regression (WAT-3 r3): `score` is tallied the instant a question is
    // answered, 800ms before `currentIndex` advances. The "answered" denominator
    // must count the in-feedback slide too, otherwise the badge briefly reads
    // "1 / 0 correct" (numerator ahead of denominator) during the feedback delay.
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    await optionButton(wrapper, 'Paris')!.trigger('click')
    await flushPromises()

    // Still showing feedback (timer NOT advanced). Badge already reads 1 / 1.
    expect(wrapper.text()).toContain('Correct!')
    expect(wrapper.text()).toContain('1 / 1 correct')
    expect(wrapper.text()).not.toContain('1 / 0 correct')
  })

  it('after the last question shows the completion screen with the final score', async () => {
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    // Q1: answer correctly.
    await optionButton(wrapper, 'Paris')!.trigger('click')
    vi.advanceTimersByTime(800)
    await flushPromises()

    // Q2: answer incorrectly.
    await optionButton(wrapper, 'Seoul')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Not quite')
    vi.advanceTimersByTime(800)
    await flushPromises()

    // Completion screen with 1/2 correct.
    expect(wrapper.text()).toContain('Lesson complete!')
    expect(wrapper.text()).toContain('1/2')
  })

  it('shows a perfect-score message when all answers are correct', async () => {
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    await optionButton(wrapper, 'Paris')!.trigger('click')
    vi.advanceTimersByTime(800)
    await flushPromises()

    await optionButton(wrapper, 'Tokyo')!.trigger('click')
    vi.advanceTimersByTime(800)
    await flushPromises()

    expect(wrapper.text()).toContain('Perfect!')
    expect(wrapper.text()).toContain('2/2')
  })

  it('ignores a second tap while feedback is showing (double-tap guard)', async () => {
    fetchLesson.mockImplementation(async (id: string) =>
      ([twoQuestionLesson()] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    await optionButton(wrapper, 'Paris')!.trigger('click') // correct
    await optionButton(wrapper, 'Berlin')!.trigger('click') // should be ignored
    vi.advanceTimersByTime(800)
    await flushPromises()

    // Only the first (correct) answer counted.
    expect(wrapper.text()).toContain('1 / 1 correct')
  })

  it('renders an info-only slide and advances on Continue (no score)', async () => {
    // A lesson that mixes an info-only slide with a question proves the generic
    // player renders each registered slide-type component and advances via the
    // contract event (`continue` for info-only).
    const mixedLesson: Lesson = {
      id: 'l1',
      presentationId: 5,
      title: 'Mixed Lesson',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
      publishedAt: null,
      description: '',
      status: 'draft',
      slides: [
        { id: 1, type: 'infoSlide', title: 'Welcome', body: 'Read this first.' },
        {
          id: 2,
          type: 'pickAnswer',
          question: 'Capital of France?',
          options: [
            { id: 11, text: 'Paris', isCorrect: true },
            { id: 12, text: 'Berlin', isCorrect: false },
          ],
        },
      ],
    } as unknown as Lesson
    fetchLesson.mockImplementation(async (id: string) =>
      ([mixedLesson] as Lesson[]).find((l) => l.id === id) ?? null)
    const wrapper = mountPlay()
    await flushPromises()

    // Info slide renders its content + a Continue button (no score badge yet).
    expect(wrapper.text()).toContain('Welcome')
    expect(wrapper.text()).toContain('Read this first.')
    const cont = wrapper.findAll('button').find((b) => b.text().includes('Continue'))
    await cont!.trigger('click')
    await flushPromises()

    // Advanced to the question slide; score denominator counts only the question.
    expect(wrapper.text()).toContain('Capital of France?')
    await optionButton(wrapper, 'Paris')!.trigger('click')
    vi.advanceTimersByTime(800)
    await flushPromises()

    // Completion: 1/1 scored (the info slide does not count toward score).
    expect(wrapper.text()).toContain('1/1')
    expect(wrapper.text()).toContain('correct')
  })
})
