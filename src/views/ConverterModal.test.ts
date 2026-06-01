// Component/interaction tests for ConverterModal.vue.
//
// MOUNT the modal (open), MOCK the presentations API + the lesson-converter
// helpers, and assert that it (a) lists the fetched presentations, (b) supports
// multi-select, and (c) on confirm calls convertPresentationToLesson for each
// selected id, persists via addLessons, and emits `created`.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Presentation } from '@/api/presentations'
import type { Lesson } from '@/lessons/lessons'

// --- Mock the presentations API --------------------------------------------
const fetchPresentationList = vi.fn()
vi.mock('@/api/presentations', () => ({
  fetchPresentationList: (...args: unknown[]) => fetchPresentationList(...args),
}))

// --- Mock the lessons converter + persistence ------------------------------
const convertPresentationToLesson = vi.fn()
const saveLesson = vi.fn()
vi.mock('@/lessons/lessons', () => ({
  convertPresentationToLesson: (...args: unknown[]) => convertPresentationToLesson(...args),
}))
vi.mock('@/api/lessons-api', () => ({
  saveLesson: (...args: unknown[]) => saveLesson(...args),
}))

import ConverterModal from './ConverterModal.vue'

function makePresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    id: 1,
    name: 'Deck One',
    accessCode: 'AAA111',
    slideCount: 8,
    participantsCount: 0,
    onlineCount: 0,
    presenting: false,
    language: 'en',
    folderId: null,
    thumbnailImage: null,
    customThumbnailImage: null,
    createdAt: '2026-05-01T10:00:00Z',
    modifiedAt: '2026-05-01T10:00:00Z',
    lastEditedAt: '2026-05-01T10:00:00Z',
    ...over,
  }
}

function makeLesson(id: number): Lesson {
  return {
    id: `lesson_${id}`,
    presentationId: id,
    title: `Deck ${id}`,
    description: '',
    status: 'draft',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    publishedAt: null,
    slides: [{ id: 1, type: 'pickAnswer', question: 'Q', options: [{ id: 1, text: 'A', isCorrect: true }] }],
  }
}

// Mount closed, then open — the component loads presentations on the
// `open` false→true transition (a watcher), not on initial mount.
async function mountAndOpen() {
  const wrapper = mount(ConverterModal, {
    props: { open: false },
    global: {
      plugins: [Antd],
      // a-modal teleports to body; render inline so we can query it.
      stubs: { teleport: true },
    },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('ConverterModal.vue', () => {
  it('loads and lists presentations when opened', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [
        makePresentation({ id: 1, name: 'Deck One', accessCode: 'AAA111' }),
        makePresentation({ id: 2, name: 'Deck Two', accessCode: 'BBB222' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    const wrapper = await mountAndOpen()

    // (a) it called the list API with the default params on open …
    expect(fetchPresentationList).toHaveBeenCalledOnce()
    expect(fetchPresentationList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, sortColumn: 'lastEditedAt', sortOrder: 'desc' }),
    )
    // … and loaded the returned presentations into its selectable list.
    // (a-modal lazy-renders its body via its own teleport, so we assert the
    // component state that the cards are bound to rather than the DOM.)
    const vm = wrapper.vm as unknown as { items: Presentation[]; loading: boolean }
    expect(vm.loading).toBe(false)
    expect(vm.items.map((p) => p.name)).toEqual(['Deck One', 'Deck Two'])
    expect(vm.items.map((p) => p.accessCode)).toContain('AAA111')
  })

  it('multi-selects presentations and reflects the selected count', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 1 }), makePresentation({ id: 2 })],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    const wrapper = await mountAndOpen()

    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      selectedCount: number
    }
    vm.toggle(1)
    vm.toggle(2)
    await flushPromises()
    expect(vm.selectedCount).toBe(2)

    // toggling again de-selects
    vm.toggle(1)
    await flushPromises()
    expect(vm.selectedCount).toBe(1)
  })

  it('confirm converts each selected presentation, persists, and emits created', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 1, name: 'Deck One' }), makePresentation({ id: 2, name: 'Deck Two' })],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    convertPresentationToLesson.mockImplementation(async (id: number) => makeLesson(id))
    saveLesson.mockImplementation(async (input: { id: string }) => ({
      ...makeLesson(Number(input.id.replace('lesson_', ''))),
      id: input.id,
    }))

    const wrapper = await mountAndOpen()

    const vm = wrapper.vm as unknown as { toggle: (id: number) => void; confirm: () => Promise<void> }
    vm.toggle(1)
    vm.toggle(2)
    await flushPromises()

    await vm.confirm()
    await flushPromises()

    // converted both selected ids
    expect(convertPresentationToLesson).toHaveBeenCalledTimes(2)
    expect(convertPresentationToLesson).toHaveBeenCalledWith(1, 'Deck One')
    expect(convertPresentationToLesson).toHaveBeenCalledWith(2, 'Deck Two')

    // persisted each converted lesson to D1 and emitted them to the parent
    expect(saveLesson).toHaveBeenCalledTimes(2)
    const created = wrapper.emitted('created')
    expect(created).toBeTruthy()
    expect((created![0][0] as Lesson[]).length).toBe(2)
  })

  it('reports skipped presentations that yield no lesson (no pick-answer slides)', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 1, name: 'Empty Deck' })],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    })
    convertPresentationToLesson.mockResolvedValue(null) // no pick-answer slides

    const wrapper = await mountAndOpen()

    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
      convertMsg: string | null
    }
    vm.toggle(1)
    await vm.confirm()
    await flushPromises()

    expect(saveLesson).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeFalsy()
    // The skip is surfaced to the user via the convertMsg banner.
    expect(vm.convertMsg).toContain('skipped')
  })
})
