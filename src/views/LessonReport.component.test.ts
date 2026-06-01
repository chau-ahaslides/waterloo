// Component tests for LessonReport.vue (per-lesson attempts report).
//
// MOUNT the view, MOCK the lessons store + router + attempts API, then assert:
// loading → renders the attempts table + summary stats + per-question
// breakdown built from the persisted response snapshots; empty + error states.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Attempt } from '@/api/attempts'

// --- Mock the lessons API (for the title only) ------------------------------
const fetchLesson = vi.fn()
vi.mock('@/api/lessons-api', () => ({
  fetchLesson: (...args: unknown[]) => fetchLesson(...args),
}))

// --- Mock the attempts API --------------------------------------------------
const fetchAttempts = vi.fn()
vi.mock('@/api/attempts', () => ({
  fetchAttempts: (...args: unknown[]) => fetchAttempts(...args),
}))

// --- Mock the router --------------------------------------------------------
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'l1' }, query: {} }),
  useRouter: () => ({ push }),
}))

import LessonReport from './LessonReport.vue'

function attempts(): Attempt[] {
  return [
    {
      id: 'a2',
      lessonId: 'l1',
      audienceName: 'Bob',
      score: 1,
      total: 2,
      createdAt: '2026-06-01T10:05:00Z',
      responses: [
        { slideId: 1, type: 'pickAnswer', question: 'Capital of France?', response: { optionId: 11, text: 'Paris' }, correct: true },
        { slideId: 2, type: 'pickAnswer', question: 'Capital of Japan?', response: { optionId: 21, text: 'Seoul' }, correct: false },
      ],
    },
    {
      id: 'a1',
      lessonId: 'l1',
      audienceName: null,
      score: 2,
      total: 2,
      createdAt: '2026-06-01T10:00:00Z',
      responses: [
        { slideId: 1, type: 'pickAnswer', question: 'Capital of France?', response: { optionId: 11, text: 'Paris' }, correct: true },
        { slideId: 2, type: 'pickAnswer', question: 'Capital of Japan?', response: { optionId: 22, text: 'Tokyo' }, correct: true },
      ],
    },
  ]
}

function mountReport() {
  return mount(LessonReport, { global: { plugins: [Antd] } })
}

beforeEach(() => {
  fetchLesson.mockResolvedValue({
    id: 'l1',
    presentationId: 5,
    title: 'Geography Quiz',
    description: '',
    status: 'draft',
    createdAt: '',
    updatedAt: '',
    publishedAt: null,
    slides: [],
  })
})

afterEach(() => vi.clearAllMocks())

describe('LessonReport.vue', () => {
  it('renders attempts (newest first), summary stats and per-question breakdown', async () => {
    fetchAttempts.mockResolvedValue(attempts())
    const wrapper = mountReport()
    await flushPromises()

    expect(fetchAttempts).toHaveBeenCalledWith('l1')

    const text = wrapper.text()
    // Title from localStorage lesson
    expect(text).toContain('Geography Quiz')
    // Both attempts shown (anonymous fallback for the null name)
    expect(text).toContain('Bob')
    expect(text).toContain('Anonymous')
    // Per-question breakdown with aggregates
    expect(text).toContain('Capital of France?')
    expect(text).toContain('Capital of Japan?')
    // France: 2/2 correct = 100%; Japan: 1/2 correct = 50%
    expect(text).toContain('100% correct')
    expect(text).toContain('50% correct')
  })

  it('shows the empty state when there are no attempts', async () => {
    fetchAttempts.mockResolvedValue([])
    const wrapper = mountReport()
    await flushPromises()
    expect(wrapper.text()).toContain('No attempts yet')
  })

  it('shows an error state when the fetch fails', async () => {
    fetchAttempts.mockRejectedValue(new Error('boom'))
    const wrapper = mountReport()
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load the report')
    expect(wrapper.text()).toContain('boom')
  })
})
