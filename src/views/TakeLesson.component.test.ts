// Component/interaction tests for TakeLesson.vue (the REAL audience run).
//
// MOUNT the view, MOCK the lessons store + router + attempts API, then drive
// the real UI: start screen → answer through the shared player → confirm the
// attempt is POSTed (with score/total + collected response snapshots) and the
// confirmation screen + report link render. Retake posts a SECOND attempt.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Lesson } from '@/lessons/lessons'

// --- Mock the lessons store -------------------------------------------------
const loadLessons = vi.fn()
vi.mock('@/lessons/lessons', () => ({
  loadLessons: () => loadLessons(),
}))

// --- Mock the attempts API --------------------------------------------------
const submitAttempt = vi.fn()
vi.mock('@/api/attempts', () => ({
  submitAttempt: (...args: unknown[]) => submitAttempt(...args),
}))

// --- Mock the router --------------------------------------------------------
const push = vi.fn()
let routeId = 'l1'
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: routeId }, query: { token: 'abc' } }),
  useRouter: () => ({ push }),
}))

import TakeLesson from './TakeLesson.vue'

function twoQuestionLesson(): Lesson {
  return {
    id: 'l1',
    presentationId: 5,
    title: 'Geography Quiz',
    createdAt: '2026-06-01T00:00:00Z',
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
  } as Lesson
}

function mountTake() {
  return mount(TakeLesson, { global: { plugins: [Antd] } })
}

/** Answer one pick-answer slide by clicking the option at `optionIndex`. */
async function answerSlide(wrapper: ReturnType<typeof mountTake>, optionIndex: number) {
  const buttons = wrapper.findAll('button').filter((b) => {
    const t = b.text()
    return /Paris|Berlin|Seoul|Tokyo/.test(t)
  })
  await buttons[optionIndex].trigger('click')
  // advance after the 800ms feedback delay
  await vi.advanceTimersByTimeAsync(900)
  await flushPromises()
}

beforeEach(() => {
  routeId = 'l1'
  loadLessons.mockReturnValue([twoQuestionLesson()])
  submitAttempt.mockResolvedValue({ id: 'att_1' })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TakeLesson.vue', () => {
  it('shows a start screen with the lesson title and a Start button', () => {
    const wrapper = mountTake()
    expect(wrapper.text()).toContain('Geography Quiz')
    expect(wrapper.text()).toContain('Start lesson')
  })

  it('plays through, submits the attempt with score/total + responses, and confirms', async () => {
    const wrapper = mountTake()

    // Enter a name + start
    await wrapper.find('input').setValue('Ada')
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('Start lesson'))!
    await startBtn.trigger('click')
    await flushPromises()

    // Q1: pick Paris (correct, index 0); Q2: pick Tokyo (correct, index 1).
    await answerSlide(wrapper, 0)
    await answerSlide(wrapper, 1)
    await flushPromises()

    expect(submitAttempt).toHaveBeenCalledTimes(1)
    const [lessonId, payload] = submitAttempt.mock.calls[0]
    expect(lessonId).toBe('l1')
    expect(payload.audienceName).toBe('Ada')
    expect(payload.score).toBe(2)
    expect(payload.total).toBe(2)
    expect(payload.responses).toHaveLength(2)
    expect(payload.responses[0]).toMatchObject({ slideId: 1, type: 'pickAnswer', correct: true })

    // Confirmation screen (2/2 correct ⇒ "Perfect!" heading + score + confirmation)
    expect(wrapper.text()).toContain('2/2')
    expect(wrapper.text()).toContain('saved to the lesson report')
    expect(wrapper.text()).toContain('View report')
  })

  it('shows an error alert when submission fails (but still completes)', async () => {
    submitAttempt.mockRejectedValueOnce(new Error('network down'))
    const wrapper = mountTake()

    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('Start lesson'))!
    await startBtn.trigger('click')
    await flushPromises()

    await answerSlide(wrapper, 1) // Q1 wrong
    await answerSlide(wrapper, 0) // Q2 wrong
    await flushPromises()

    expect(submitAttempt).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('could not be saved')
    expect(wrapper.text()).toContain('network down')
  })

  it('navigates to the report when View report is clicked', async () => {
    const wrapper = mountTake()
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('Start lesson'))!
    await startBtn.trigger('click')
    await flushPromises()
    await answerSlide(wrapper, 0)
    await answerSlide(wrapper, 1)
    await flushPromises()

    const reportBtn = wrapper.findAll('button').find((b) => b.text().includes('View report'))!
    await reportBtn.trigger('click')
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'lesson-report', params: { id: 'l1' } }),
    )
  })

  it('renders the not-found screen for an unknown lesson', () => {
    loadLessons.mockReturnValue([])
    const wrapper = mountTake()
    expect(wrapper.text()).toContain('Lesson not found')
  })
})
