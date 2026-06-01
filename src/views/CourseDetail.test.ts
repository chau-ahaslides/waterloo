// Component tests for CourseDetail.vue (WAT-14).
//
// MOUNT the page, MOCK the courses API, and assert:
// - it loads the course + members and shows the computed total duration,
// - add / remove / reorder call the API,
// - editing the title saves via patchCourse,
// - Publish calls publishCourse and surfaces the share link.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { CourseDetailResponse } from '@/api/courses-api'

const fetchCourseDetail = vi.fn()
const fetchNormalizedLessons = vi.fn()
const patchCourse = vi.fn()
const addCourseLesson = vi.fn()
const removeCourseLesson = vi.fn()
const reorderCourse = vi.fn()
const publishCourse = vi.fn()
const unpublishCourse = vi.fn()

vi.mock('@/api/courses-api', () => ({
  fetchCourseDetail: (id: string) => fetchCourseDetail(id),
  fetchNormalizedLessons: () => fetchNormalizedLessons(),
  patchCourse: (id: string, p: unknown) => patchCourse(id, p),
  addCourseLesson: (id: string, l: string) => addCourseLesson(id, l),
  removeCourseLesson: (id: string, l: string) => removeCourseLesson(id, l),
  reorderCourse: (id: string, o: string[]) => reorderCourse(id, o),
  publishCourse: (id: string) => publishCourse(id),
  unpublishCourse: (id: string) => unpublishCourse(id),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { courseId: 'c1' }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

import CourseDetail from './CourseDetail.vue'

function detail(over: Partial<CourseDetailResponse['course']> = {}, lessons?: CourseDetailResponse['lessons']): CourseDetailResponse {
  return {
    course: {
      id: 'c1',
      title: 'My Course',
      description: 'Desc',
      authMode: 'name',
      orderMode: 'free',
      status: 'draft',
      shareLinkSlug: null,
      publishedAt: null,
      lessonCount: 2,
      totalDurationMinutes: 12,
      createdAt: '2026-06-01T09:00:00Z',
      updatedAt: '2026-06-01T09:00:00Z',
      ...over,
    },
    lessons: lessons ?? [
      { courseLessonId: 'cl1', order: 0, lessonId: 'l1', title: 'Lesson One', status: 'published', shareLinkSlug: 's1', estimatedDurationMinutes: 5, slideCount: 10 },
      { courseLessonId: 'cl2', order: 1, lessonId: 'l2', title: 'Lesson Two', status: 'published', shareLinkSlug: 's2', estimatedDurationMinutes: 7, slideCount: 8 },
    ],
  }
}

function mountDetail() {
  return mount(CourseDetail, { global: { plugins: [Antd] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCourseDetail.mockResolvedValue(detail())
  fetchNormalizedLessons.mockResolvedValue([])
})

describe('CourseDetail.vue', () => {
  it('loads the course + members and shows the total duration', async () => {
    const wrapper = mountDetail()
    await flushPromises()
    expect(fetchCourseDetail).toHaveBeenCalledWith('c1')
    expect(wrapper.text()).toContain('My Course')
    expect(wrapper.text()).toContain('Lesson One')
    expect(wrapper.text()).toContain('Lesson Two')
    expect(wrapper.find('[data-testid="total-duration"]').text()).toContain('12 min')
  })

  it('editing the title patches the course', async () => {
    patchCourse.mockResolvedValue(detail({ title: 'Renamed' }))
    const wrapper = mountDetail()
    await flushPromises()
    await wrapper.find('[data-testid="edit-title"]').trigger('click')
    const input = wrapper.find('[data-testid="title-input"] input').exists()
      ? wrapper.find('[data-testid="title-input"] input')
      : wrapper.find('[data-testid="title-input"]')
    await input.setValue('Renamed')
    await wrapper.find('[data-testid="save-title"]').trigger('click')
    await flushPromises()
    expect(patchCourse).toHaveBeenCalledWith('c1', { title: 'Renamed' })
    expect(wrapper.text()).toContain('Renamed')
  })

  it('reorder (move down) persists the new lesson-id order', async () => {
    reorderCourse.mockResolvedValue(detail())
    const wrapper = mountDetail()
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="member-lesson"]')
    expect(rows.length).toBe(2)
    // First row's "move down" button.
    const downBtn = rows[0].find('.reorder-down')
    await downBtn.trigger('click')
    await flushPromises()
    expect(reorderCourse).toHaveBeenCalledWith('c1', ['l2', 'l1'])
  })

  it('Publish calls publishCourse and shows the share link', async () => {
    publishCourse.mockResolvedValue(detail({ status: 'published', shareLinkSlug: 'coursexyz' }))
    const wrapper = mountDetail()
    await flushPromises()
    await wrapper.find('[data-testid="publish-btn"]').trigger('click')
    await flushPromises()
    expect(publishCourse).toHaveBeenCalledWith('c1')
    expect(wrapper.find('[data-testid="share-link"]').text()).toContain('learn/c/coursexyz')
  })

  it('add-lesson panel adds a lesson via the API', async () => {
    fetchNormalizedLessons.mockResolvedValue([
      { id: 'l3', sourcePresentationId: 1, title: 'Lesson Three', status: 'published', createdAt: '', estimatedDurationMinutes: 4, language: 'en', slideCount: 3 },
    ])
    addCourseLesson.mockResolvedValue(detail())
    const wrapper = mountDetail()
    await flushPromises()
    await wrapper.find('[data-testid="open-add"]').trigger('click')
    await flushPromises()
    const candidate = wrapper.find('[data-testid="add-candidate"]')
    expect(candidate.exists()).toBe(true)
    await candidate.trigger('click')
    await flushPromises()
    expect(addCourseLesson).toHaveBeenCalledWith('c1', 'l3')
  })
})
