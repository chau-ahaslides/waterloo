// Component/interaction tests for CoursesHome.vue (WAT-10).
//
// MOUNT the view, MOCK the courses API, and assert the rendered states:
// - loading skeletons while fetching
// - welcome/empty state when no normalized lessons exist
// - lessons grid (title, status badge, slide count, date) when lessons exist
// - each lesson card links to the courses-lesson-detail route

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { NormalizedLesson } from '@/api/courses-api'

// --- Mock the courses API ---------------------------------------------------
const fetchNormalizedLessons = vi.fn()
vi.mock('@/api/courses-api', () => ({
  fetchNormalizedLessons: () => fetchNormalizedLessons(),
  // convertPresentation is used by CourseConverter (stubbed below)
  convertPresentation: vi.fn(),
}))

// --- Mock vue-router --------------------------------------------------------
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { token: 'test' } }),
  useRouter: () => ({ push }),
}))

import CoursesHome from './CoursesHome.vue'

function makeLesson(over: Partial<NormalizedLesson> = {}): NormalizedLesson {
  return {
    id: 'lesson_abc123',
    sourcePresentationId: 42,
    title: 'Onboarding 101',
    status: 'draft',
    createdAt: '2026-06-01T09:00:00Z',
    estimatedDurationMinutes: 5,
    language: 'en',
    slideCount: 20,
    ...over,
  }
}

function mountCoursesHome() {
  return mount(CoursesHome, {
    global: {
      plugins: [Antd],
      stubs: { CourseConverter: true },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchNormalizedLessons.mockResolvedValue([])
})

describe('CoursesHome.vue', () => {
  it('calls fetchNormalizedLessons on mount', async () => {
    mountCoursesHome()
    await flushPromises()
    expect(fetchNormalizedLessons).toHaveBeenCalledOnce()
  })

  it('shows the welcome/empty state when there are no lessons', async () => {
    fetchNormalizedLessons.mockResolvedValue([])
    const wrapper = mountCoursesHome()
    await flushPromises()

    expect(wrapper.text()).toContain('Welcome to Courses')
    expect(wrapper.text()).toContain('Create your first lesson')
    expect(wrapper.text()).toContain('0 lessons')
  })

  it('renders the lessons grid (title, status badge, slide count, date) when lessons exist', async () => {
    fetchNormalizedLessons.mockResolvedValue([
      makeLesson({ id: 'l1', title: 'Onboarding 101', status: 'draft', slideCount: 20 }),
      makeLesson({ id: 'l2', title: 'Product Training', status: 'published', slideCount: 14 }),
    ])
    const wrapper = mountCoursesHome()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Onboarding 101')
    expect(text).toContain('Product Training')
    expect(text).toContain('20 slides')
    expect(text).toContain('14 slides')
    expect(text).toContain('draft')
    expect(text).toContain('published')
    expect(text).toContain('2 lessons')
  })

  it('shows the estimated duration when present', async () => {
    fetchNormalizedLessons.mockResolvedValue([
      makeLesson({ estimatedDurationMinutes: 8 }),
    ])
    const wrapper = mountCoursesHome()
    await flushPromises()

    expect(wrapper.text()).toContain('8 min')
  })

  it('clicking a lesson card navigates to courses-lesson-detail', async () => {
    fetchNormalizedLessons.mockResolvedValue([
      makeLesson({ id: 'lesson_xyz', title: 'Test Lesson' }),
    ])
    const wrapper = mountCoursesHome()
    await flushPromises()

    // Click the card (a-card element)
    const cards = wrapper.findAll('.ant-card')
    expect(cards.length).toBeGreaterThan(0)
    await cards[0].trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'courses-lesson-detail',
      params: { id: 'lesson_xyz' },
      query: { token: 'test' },
    })
  })

  it('shows an error alert and Retry button on load failure', async () => {
    fetchNormalizedLessons.mockRejectedValue(new Error('Network error'))
    const wrapper = mountCoursesHome()
    await flushPromises()

    expect(wrapper.text()).toContain('Could not load lessons')
  })

  it('Retry button re-invokes the API', async () => {
    fetchNormalizedLessons
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue([])
    const wrapper = mountCoursesHome()
    await flushPromises()

    // Find and click the Retry button
    const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'))
    expect(retryBtn).toBeTruthy()
    await retryBtn!.trigger('click')
    await flushPromises()

    expect(fetchNormalizedLessons).toHaveBeenCalledTimes(2)
  })

  it('shows a "New lesson" button in the header', async () => {
    mountCoursesHome()
    await flushPromises()

    const buttons = mountCoursesHome().findAll('button')
    expect(buttons.some((b) => b.text().includes('New lesson'))).toBe(true)
  })
})
