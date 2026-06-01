// Component tests for CourseDashboard.vue (WAT-15).
//
// MOUNT the page, MOCK fetchCourseAnalytics, and assert:
// - course-level stats cards render,
// - the per-lesson breakdown table renders started/completed/drop-off,
// - clicking a lesson row drills into that lesson's dashboard,
// - ANONYMOUS course → aggregate-only notice.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { CourseAnalytics } from '@/api/courses-api'

const fetchCourseAnalytics = vi.fn()
const push = vi.fn()

vi.mock('@/api/courses-api', () => ({
  fetchCourseAnalytics: (id: string) => fetchCourseAnalytics(id),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { courseId: 'c1' }, query: {} }),
  useRouter: () => ({ push }),
}))

import CourseDashboard from './CourseDashboard.vue'

function analytics(over: Partial<CourseAnalytics> = {}): CourseAnalytics {
  return {
    course: { id: 'c1', title: 'Onboarding', status: 'published', authMode: 'name' },
    anonymous: false,
    stats: { joined: 4, completed: 2, completionRate: 50, avgTimeToCompleteSeconds: 1200 },
    lessons: [
      { lessonId: 'l1', title: 'Lesson One', order: 0, estimatedDurationMinutes: 5, started: 4, completed: 3, dropOff: 1, completionRate: 75 },
      { lessonId: 'l2', title: 'Lesson Two', order: 1, estimatedDurationMinutes: 7, started: 3, completed: 2, dropOff: 1, completionRate: 66.7 },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CourseDashboard.vue', () => {
  it('renders course-level stats', async () => {
    fetchCourseAnalytics.mockResolvedValue(analytics())
    const w = mount(CourseDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(fetchCourseAnalytics).toHaveBeenCalledWith('c1')
    expect(w.find('[data-testid="course-joined"]').text()).toBe('4')
    expect(w.find('[data-testid="course-completed"]').text()).toBe('2')
    expect(w.find('[data-testid="course-rate"]').text()).toContain('50%')
    expect(w.find('[data-testid="course-avg-time"]').text()).toContain('20m')
  })

  it('renders the per-lesson breakdown table with drop-off', async () => {
    fetchCourseAnalytics.mockResolvedValue(analytics())
    const w = mount(CourseDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    const table = w.find('[data-testid="lesson-breakdown-table"]')
    expect(table.exists()).toBe(true)
    const text = table.text()
    expect(text).toContain('Lesson One')
    expect(text).toContain('Lesson Two')
    expect(text).toContain('75%')
  })

  it('drills into a lesson dashboard when a row is clicked', async () => {
    fetchCourseAnalytics.mockResolvedValue(analytics())
    const w = mount(CourseDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    const firstRow = w.find('[data-testid="lesson-breakdown-table"] tbody tr')
    expect(firstRow.exists()).toBe(true)
    await firstRow.trigger('click')
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'lesson-dashboard', params: { id: 'l1' } }),
    )
  })

  it('ANONYMOUS course → aggregate-only notice', async () => {
    fetchCourseAnalytics.mockResolvedValue(
      analytics({ anonymous: true, course: { id: 'c1', title: 'Anon', status: 'published', authMode: 'anonymous' } }),
    )
    const w = mount(CourseDashboard, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(w.find('[data-testid="course-anonymous-notice"]').exists()).toBe(true)
  })
})
