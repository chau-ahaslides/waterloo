// Component tests for LearnCourse.vue (WAT-14) — the PUBLIC mobile course player.
//
// MOUNT the view, MOCK the public course API + vue-router, and assert:
// - landing renders title/description/lessons + total time + auth field,
// - Start (name course) resolves the learner and shows the overview,
// - sequential locking: only the first lesson is tappable until it completes,
// - free mode: all lessons tappable,
// - returning with ?completed=<id> marks complete; completing all → completion.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PublicCourse } from '@/api/courses-api'

const fetchCourseBySlug = vi.fn()
const startCourseLearner = vi.fn()
const saveCourseLessonProgress = vi.fn()
vi.mock('@/api/courses-api', () => ({
  fetchCourseBySlug: (slug: string, learnerId?: string) => fetchCourseBySlug(slug, learnerId),
  startCourseLearner: (slug: string, id: string) => startCourseLearner(slug, id),
  saveCourseLessonProgress: (s: string, l: string, ls: string, c: boolean) =>
    saveCourseLessonProgress(s, l, ls, c),
}))

const push = vi.fn()
const replace = vi.fn()
let routeQuery: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { slug: 'coursexyz' }, query: routeQuery }),
  useRouter: () => ({ push, replace }),
}))

import LearnCourse from './LearnCourse.vue'

function course(over: Partial<PublicCourse> = {}): PublicCourse {
  return {
    id: 'c1',
    title: 'Onboarding',
    description: 'Welcome aboard',
    authMode: 'name',
    orderMode: 'sequential',
    totalDurationMinutes: 12,
    lessons: [
      { lessonId: 'l1', slug: 's1', title: 'Lesson One', order: 0, estimatedDurationMinutes: 5 },
      { lessonId: 'l2', slug: 's2', title: 'Lesson Two', order: 1, estimatedDurationMinutes: 7 },
    ],
    ...over,
  }
}

function mountLearn() {
  return mount(LearnCourse)
}

beforeEach(() => {
  vi.clearAllMocks()
  routeQuery = {}
  localStorage.clear()
  fetchCourseBySlug.mockResolvedValue({ available: true, course: course(), completedLessonIds: [] })
})

describe('LearnCourse.vue', () => {
  it('shows not-available for an unknown course', async () => {
    fetchCourseBySlug.mockResolvedValue({ available: false, error: 'This course is not available.' })
    const wrapper = mountLearn()
    await flushPromises()
    expect(wrapper.text()).toContain('Course not available')
  })

  it('renders the landing with title, lessons, total time, and a name field', async () => {
    const wrapper = mountLearn()
    await flushPromises()
    expect(wrapper.text()).toContain('Onboarding')
    expect(wrapper.text()).toContain('Welcome aboard')
    expect(wrapper.text()).toContain('Lesson One')
    expect(wrapper.text()).toContain('Lesson Two')
    expect(wrapper.text()).toContain('12 min')
    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
  })

  it('Start resolves the learner and shows the overview with sequential locking', async () => {
    startCourseLearner.mockResolvedValue({ learnerId: 'learner_1', completedLessonIds: [] })
    const wrapper = mountLearn()
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('Sam')
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('Start course'))
    await startBtn!.trigger('click')
    await flushPromises()

    expect(startCourseLearner).toHaveBeenCalledWith('coursexyz', 'Sam')
    // Lesson 0 unlocked, lesson 1 locked (sequential).
    const l0 = wrapper.find('[data-testid="lesson-0"]')
    const l1 = wrapper.find('[data-testid="lesson-1"]')
    expect((l0.element as HTMLButtonElement).disabled).toBe(false)
    expect((l1.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('0 of 2 lessons complete')
  })

  it('tapping the first lesson navigates to the lesson player with course context', async () => {
    startCourseLearner.mockResolvedValue({ learnerId: 'learner_1', completedLessonIds: [] })
    const wrapper = mountLearn()
    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('Sam')
    await wrapper.findAll('button').find((b) => b.text().includes('Start course'))!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="lesson-0"]').trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'learn-lesson',
      params: { slug: 's1' },
      query: { course: 'coursexyz', learner: 'learner_1' },
    })
  })

  it('free mode unlocks every lesson immediately', async () => {
    fetchCourseBySlug.mockResolvedValue({
      available: true,
      course: course({ orderMode: 'free', authMode: 'anonymous' }),
      completedLessonIds: [],
    })
    const wrapper = mountLearn()
    await flushPromises()
    // anonymous → landing still shows; Start without input.
    await wrapper.findAll('button').find((b) => b.text().includes('Start course'))!.trigger('click')
    await flushPromises()
    const l0 = wrapper.find('[data-testid="lesson-0"]')
    const l1 = wrapper.find('[data-testid="lesson-1"]')
    expect((l0.element as HTMLButtonElement).disabled).toBe(false)
    expect((l1.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('returning with ?completed marks the lesson complete; completing all → completion', async () => {
    // First lesson already complete; we return having just completed lesson 2.
    fetchCourseBySlug.mockResolvedValue({
      available: true,
      course: course(),
      completedLessonIds: ['l1'],
    })
    saveCourseLessonProgress.mockResolvedValue({
      ok: true,
      completedLessonIds: ['l1', 'l2'],
      courseComplete: true,
    })
    routeQuery = { completed: 'l2', learner: 'learner_1' }
    const wrapper = mountLearn()
    await flushPromises()

    expect(saveCourseLessonProgress).toHaveBeenCalledWith('coursexyz', 'learner_1', 'l2', true)
    expect(wrapper.text()).toContain('Course complete!')
  })

  it('anonymous course persists completion in localStorage', async () => {
    fetchCourseBySlug.mockResolvedValue({
      available: true,
      course: course({ orderMode: 'free', authMode: 'anonymous' }),
      completedLessonIds: [],
    })
    routeQuery = { completed: 'l1' }
    mountLearn()
    await flushPromises()
    const stored = JSON.parse(localStorage.getItem('aha-learn-course:coursexyz') || '[]')
    expect(stored).toContain('l1')
    // No server call for anonymous.
    expect(saveCourseLessonProgress).not.toHaveBeenCalled()
  })
})
