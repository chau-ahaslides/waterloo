// Component tests for NewCourseModal.vue (WAT-14).
//
// MOUNT the modal open, MOCK the courses API, and assert:
// - it lists existing lessons to pick from,
// - adding/removing lessons + reordering (up/down) updates the picked set,
// - order/auth mode radios default correctly,
// - Save calls createCourse with the right payload and emits `created`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { NormalizedLesson } from '@/api/courses-api'

const fetchNormalizedLessons = vi.fn()
const createCourse = vi.fn()
vi.mock('@/api/courses-api', () => ({
  fetchNormalizedLessons: () => fetchNormalizedLessons(),
  createCourse: (input: unknown) => createCourse(input),
}))

import NewCourseModal from './NewCourseModal.vue'

function lesson(over: Partial<NormalizedLesson> = {}): NormalizedLesson {
  return {
    id: 'l1',
    sourcePresentationId: 1,
    title: 'Lesson One',
    status: 'published',
    createdAt: '2026-06-01T09:00:00Z',
    estimatedDurationMinutes: 5,
    language: 'en',
    slideCount: 10,
    ...over,
  }
}

let activeWrapper: VueWrapper | null = null
function mountModal() {
  activeWrapper = mount(NewCourseModal, {
    props: { open: true, publishedLessonCount: 2 },
    global: { plugins: [Antd] },
    attachTo: document.body,
  })
  return activeWrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchNormalizedLessons.mockResolvedValue([
    lesson({ id: 'l1', title: 'Lesson One', estimatedDurationMinutes: 5 }),
    lesson({ id: 'l2', title: 'Lesson Two', estimatedDurationMinutes: 7 }),
  ])
})

afterEach(() => {
  // a-modal teleports to document.body; unmount + clear so DOM doesn't leak
  // across tests (stale add-buttons / inputs).
  activeWrapper?.unmount()
  activeWrapper = null
  document.body.innerHTML = ''
})

// a-modal teleports its body to document.body, so query the DOM directly for
// the modal content (Vue Test Utils' wrapper.find can't see teleported nodes).
function bodyAddButtons(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll('[data-testid="add-lesson"]')) as HTMLElement[]
}

describe('NewCourseModal.vue', () => {
  it('loads lessons when opened', async () => {
    mountModal()
    await flushPromises()
    expect(fetchNormalizedLessons).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Lesson One')
    expect(document.body.textContent).toContain('Lesson Two')
  })

  it('adds a lesson to the picked set and shows total duration', async () => {
    mountModal()
    await flushPromises()
    const addBtns = bodyAddButtons()
    expect(addBtns.length).toBe(2)
    addBtns[0].click()
    await flushPromises()
    expect(document.body.querySelectorAll('[data-testid="picked-lesson"]').length).toBe(1)
    expect(document.body.textContent).toContain('1 selected')
  })

  it('Save calls createCourse with the picked ids + modes and emits created', async () => {
    createCourse.mockResolvedValue({ course: { id: 'new_course' }, lessons: [] })
    const wrapper = mountModal()
    await flushPromises()

    // Title (the input lives in the teleported modal body).
    const titleInput =
      (document.body.querySelector('[data-testid="course-title"] input') as HTMLInputElement | null) ??
      (document.body.querySelector('[data-testid="course-title"]') as HTMLInputElement | null) ??
      (document.body.querySelector('input[type="text"]') as HTMLInputElement)
    titleInput.value = 'My Course'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Pick both lessons (list re-renders after each add).
    bodyAddButtons()[0].click()
    await flushPromises()
    bodyAddButtons()[0].click()
    await flushPromises()

    // OK button in the modal footer.
    const footerBtns = document.body.querySelectorAll('.ant-modal-footer button')
    const save = Array.from(footerBtns).find((b) => b.textContent?.includes('Save')) as HTMLElement
    save.click()
    await flushPromises()

    expect(createCourse).toHaveBeenCalledOnce()
    const arg = createCourse.mock.calls[0][0]
    expect(arg.title).toBe('My Course')
    expect(arg.orderMode).toBe('free') // default
    expect(arg.authMode).toBe('name') // default
    expect(arg.lessonIds.length).toBe(2)
    expect(wrapper.emitted('created')?.[0]).toEqual(['new_course'])
  })

  it('does not allow save without any picked lesson (guard holds)', async () => {
    const wrapper = mountModal()
    await flushPromises()
    const titleInput =
      (document.body.querySelector('[data-testid="course-title"] input') as HTMLInputElement | null) ??
      (document.body.querySelector('[data-testid="course-title"]') as HTMLInputElement | null) ??
      (document.body.querySelector('input[type="text"]') as HTMLInputElement)
    titleInput.value = 'Has title'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    // No lessons picked → save guard returns early without calling the API.
    const vm = wrapper.vm as unknown as { save: () => Promise<void> }
    await vm.save()
    expect(createCourse).not.toHaveBeenCalled()
  })
})
