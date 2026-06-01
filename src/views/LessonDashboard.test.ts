// Component tests for LessonDashboard.vue (WAT-15).
//
// MOUNT the page, MOCK fetchLessonAnalytics, and assert:
// - stats cards render joined / completed / completion rate,
// - per-learner table renders rows + statuses for identified lessons,
// - ANONYMOUS lesson → aggregate-only notice, NO per-learner table / identifiers,
// - per-question distribution renders option counts + flags most-missed.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { LessonAnalytics } from '@/api/courses-api'

const fetchLessonAnalytics = vi.fn()

vi.mock('@/api/courses-api', () => ({
  fetchLessonAnalytics: (id: string) => fetchLessonAnalytics(id),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'l1' }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

import LessonDashboard from './LessonDashboard.vue'

function analytics(over: Partial<LessonAnalytics> = {}): LessonAnalytics {
  return {
    lesson: { id: 'l1', title: 'Discover Hanoi', status: 'published', authMode: 'name', estimatedDurationMinutes: 10 },
    anonymous: false,
    stats: { joined: 3, completed: 1, completionRate: 33.3, avgTimeToCompleteSeconds: 300, estimatedDurationMinutes: 10 },
    learners: [
      { identifier: 'Alice', status: 'completed', currentSlideOrder: 4, startedAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T10:05:00Z' },
      { identifier: 'Bob', status: 'in-progress', currentSlideOrder: 2, startedAt: '2026-06-01T10:00:00Z', completedAt: null },
      { identifier: 'Cara', status: 'joined', currentSlideOrder: 0, startedAt: '2026-06-01T10:00:00Z', completedAt: null },
    ],
    questions: [
      {
        order: 0,
        question: 'What is the capital?',
        options: [
          { index: 0, label: 'Hanoi', count: 3, isCorrect: true },
          { index: 1, label: 'Hue', count: 0, isCorrect: false },
          { index: 2, label: 'Da Nang', count: 0, isCorrect: false },
          { index: 3, label: 'Hoi An', count: 0, isCorrect: false },
        ],
        totalResponses: 3,
        correctCount: 3,
        correctRate: 100,
        mostMissed: false,
      },
      {
        order: 2,
        question: 'Which river?',
        options: [
          { index: 0, label: 'Red', count: 1, isCorrect: true },
          { index: 1, label: 'Mekong', count: 2, isCorrect: false },
          { index: 2, label: 'Nile', count: 0, isCorrect: false },
          { index: 3, label: 'Amazon', count: 0, isCorrect: false },
        ],
        totalResponses: 3,
        correctCount: 1,
        correctRate: 33.3,
        mostMissed: true,
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LessonDashboard.vue', () => {
  it('renders stats cards (joined / completed / rate / avg time)', async () => {
    fetchLessonAnalytics.mockResolvedValue(analytics())
    const w = mount(LessonDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(fetchLessonAnalytics).toHaveBeenCalledWith('l1')
    expect(w.find('[data-testid="stat-joined"]').text()).toBe('3')
    expect(w.find('[data-testid="stat-completed"]').text()).toBe('1')
    expect(w.find('[data-testid="stat-rate"]').text()).toContain('33.3%')
    expect(w.find('[data-testid="stat-avg-time"]').text()).toContain('5m')
  })

  it('renders the per-learner table with identifiers + statuses', async () => {
    fetchLessonAnalytics.mockResolvedValue(analytics())
    const w = mount(LessonDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    const table = w.find('[data-testid="learner-table"]')
    expect(table.exists()).toBe(true)
    const text = table.text()
    expect(text).toContain('Alice')
    expect(text).toContain('Bob')
    expect(text).toContain('Cara')
    expect(text).toContain('Completed')
    expect(text).toContain('In progress')
  })

  it('ANONYMOUS lesson → aggregate-only notice and NO per-learner table', async () => {
    fetchLessonAnalytics.mockResolvedValue(
      analytics({ anonymous: true, learners: null, lesson: { id: 'l1', title: 'Anon Lesson', status: 'published', authMode: 'anonymous', estimatedDurationMinutes: null } }),
    )
    const w = mount(LessonDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(w.find('[data-testid="anonymous-notice"]').exists()).toBe(true)
    expect(w.find('[data-testid="learner-table"]').exists()).toBe(false)
    // No identifiers leaked anywhere.
    expect(w.text()).not.toContain('Alice')
    // Aggregate stats still show.
    expect(w.find('[data-testid="stat-joined"]').text()).toBe('3')
  })

  it('renders per-question distribution and flags the most-missed question', async () => {
    fetchLessonAnalytics.mockResolvedValue(analytics())
    const w = mount(LessonDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    const cards = w.findAll('[data-testid="question-card"]')
    expect(cards).toHaveLength(2)
    // The second question carries the "Most missed" flag.
    expect(cards[1].text()).toContain('Most missed')
    expect(cards[0].text()).not.toContain('Most missed')
    // Option counts render.
    expect(cards[0].text()).toContain('Hanoi')
    expect(cards[1].text()).toContain('33.3% correct')
  })

  it('shows an error + retry when the fetch fails', async () => {
    fetchLessonAnalytics.mockRejectedValue(new Error('boom'))
    const w = mount(LessonDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(w.text()).toContain('Could not load dashboard')
  })
})
