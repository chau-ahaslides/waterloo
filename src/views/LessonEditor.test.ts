// Component tests for LessonEditor.vue (WAT-3). MOUNT the editor, MOCK the
// lessons API + router, then drive the real UI: load a lesson, add the 3 new
// slide types from the palette, reorder/remove, save a draft and publish.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Lesson } from '@/lessons/lessons'

// --- Mock the lessons API ---------------------------------------------------
const fetchLesson = vi.fn()
const saveLesson = vi.fn()
const publishLesson = vi.fn()
vi.mock('@/api/lessons-api', () => ({
  fetchLesson: (id: string) => fetchLesson(id),
  saveLesson: (input: unknown) => saveLesson(input),
  publishLesson: (id: string) => publishLesson(id),
}))

// --- Mock the router --------------------------------------------------------
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'l1' }, query: { token: 'abc' } }),
  useRouter: () => ({ push }),
}))

import LessonEditor from './LessonEditor.vue'

function makeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    presentationId: 5,
    title: 'Onboarding',
    description: '',
    status: 'draft',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    publishedAt: null,
    slides: [
      { id: 1, type: 'pickAnswer', question: 'Q1', options: [{ id: 1, text: 'A', isCorrect: true }] },
    ] as Lesson['slides'],
    ...over,
  }
}

function mountEditor() {
  return mount(LessonEditor, { global: { plugins: [Antd] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchLesson.mockResolvedValue(makeLesson())
  saveLesson.mockImplementation(async (input: Partial<Lesson>) => ({
    ...makeLesson(),
    ...input,
  }))
  publishLesson.mockResolvedValue(makeLesson({ status: 'published', publishedAt: '2026-06-02T00:00:00Z' }))
})

describe('LessonEditor.vue', () => {
  it('loads a lesson and shows its title + slide outline', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(fetchLesson).toHaveBeenCalledWith('l1')
    expect(wrapper.text()).toContain('Onboarding')
    expect(wrapper.text()).toContain('Slides (1)')
  })

  it('shows a not-found screen when the lesson is missing', async () => {
    fetchLesson.mockResolvedValue(null)
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.text()).toContain('Can’t open this lesson')
  })

  it('offers the 3 new authorable types (plus Quiz) in the add palette', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels.some((t) => t.includes('Text'))).toBe(true)
    expect(labels.some((t) => t.includes('HTML'))).toBe(true)
    expect(labels.some((t) => t.includes('YouTube'))).toBe(true)
    expect(labels.some((t) => t.includes('Quiz'))).toBe(true)
  })

  it('adding a Text slide appends it and selects it', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const addText = wrapper.findAll('button').find((b) => b.text().trim() === 'Text')
    await addText!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Slides (2)')
    const vm = wrapper.vm as unknown as { selectedIndex: number; dirty: boolean }
    expect(vm.selectedIndex).toBe(1)
    expect(vm.dirty).toBe(true)
  })

  it('Save draft calls saveLesson with the current lesson', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('Save draft'))
    await saveBtn!.trigger('click')
    await flushPromises()
    expect(saveLesson).toHaveBeenCalledOnce()
    expect(saveLesson.mock.calls[0][0]).toMatchObject({ id: 'l1', title: 'Onboarding' })
  })

  it('Publish flips status to published', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const pubBtn = wrapper.findAll('button').find((b) => b.text().includes('Publish'))
    await pubBtn!.trigger('click')
    await flushPromises()
    expect(publishLesson).toHaveBeenCalledWith('l1')
    expect(wrapper.text().toLowerCase()).toContain('published')
  })

  it('removeSlide drops a slide from the outline', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const vm = wrapper.vm as unknown as { removeSlide: (i: number) => void }
    vm.removeSlide(0)
    await flushPromises()
    expect(wrapper.text()).toContain('Slides (0)')
  })
})
