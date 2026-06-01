// Component/interaction tests for CourseConverter.vue (WAT-10).
//
// MOUNT the modal (open), MOCK the presentations API + convertPresentation,
// and assert:
//   (a) presentations are loaded on open
//   (b) multi-select with checkboxes
//   (c) confirm calls convertPresentation once per selected id
//   (d) progress is shown while converting
//   (e) `converted` event emitted on success
//   (f) partial failures show error summary without losing successes

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Presentation } from '@/api/presentations'

// --- Mock the presentations API ---------------------------------------------
const fetchPresentationList = vi.fn()
vi.mock('@/api/presentations', () => ({
  fetchPresentationList: (...args: unknown[]) => fetchPresentationList(...args),
}))

// --- Mock the convert function ----------------------------------------------
const convertPresentation = vi.fn()
vi.mock('@/api/courses-api', () => ({
  convertPresentation: (...args: unknown[]) => convertPresentation(...args),
  fetchNormalizedLessons: vi.fn().mockResolvedValue([]),
}))

import CourseConverter from './CourseConverter.vue'

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

async function mountAndOpen() {
  const wrapper = mount(CourseConverter, {
    props: { open: false },
    global: {
      plugins: [Antd],
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

describe('CourseConverter.vue', () => {
  it('loads presentations when opened', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [
        makePresentation({ id: 1, name: 'Deck One' }),
        makePresentation({ id: 2, name: 'Deck Two' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    const wrapper = await mountAndOpen()

    expect(fetchPresentationList).toHaveBeenCalledOnce()
    const vm = wrapper.vm as unknown as { items: Presentation[]; loading: boolean }
    expect(vm.loading).toBe(false)
    expect(vm.items.map((p) => p.name)).toEqual(['Deck One', 'Deck Two'])
  })

  it('supports multi-select toggle and reflects selectedCount', async () => {
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

    vm.toggle(1)
    await flushPromises()
    expect(vm.selectedCount).toBe(1)
  })

  it('calls convertPresentation once per selected presentation on confirm', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [
        makePresentation({ id: 1, name: 'Deck One' }),
        makePresentation({ id: 2, name: 'Deck Two' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    convertPresentation.mockResolvedValue({ lesson_id: 'lesson_1', question_count: 8 })

    const wrapper = await mountAndOpen()
    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
    }
    vm.toggle(1)
    vm.toggle(2)
    await flushPromises()

    await vm.confirm()
    await flushPromises()

    expect(convertPresentation).toHaveBeenCalledTimes(2)
    expect(convertPresentation).toHaveBeenCalledWith(1)
    expect(convertPresentation).toHaveBeenCalledWith(2)
  })

  it('emits `converted` after successful conversions', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 1, name: 'Deck One' })],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    })
    convertPresentation.mockResolvedValue({ lesson_id: 'lesson_1', question_count: 8 })

    const wrapper = await mountAndOpen()
    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
    }
    vm.toggle(1)
    await vm.confirm()
    await flushPromises()

    expect(wrapper.emitted('converted')).toBeTruthy()
  })

  it('shows progress during conversion (index / total + deck name)', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 1, name: 'Deck One' })],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    })
    // Make convert slow (never resolves) to inspect mid-conversion state
    let resolveConvert!: () => void
    convertPresentation.mockImplementation(
      () => new Promise((res) => { resolveConvert = () => res({ lesson_id: 'l', question_count: 3 }) }),
    )

    const wrapper = await mountAndOpen()
    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
      progressState: string
      progressIndex: number
      progressTotal: number
      progressCurrentName: string
      successCount: number
    }
    vm.toggle(1)
    // Start confirm (don't await — it's blocked on the slow mock)
    const confirmPromise = vm.confirm()
    await flushPromises()

    // While running: progressState should be 'running'
    expect(vm.progressState).toBe('running')
    expect(vm.progressTotal).toBe(1)
    expect(vm.progressCurrentName).toBe('Deck One')

    // Resolve the conversion
    resolveConvert()
    await confirmPromise
    await flushPromises()

    expect(vm.progressState).toBe('done')
    expect(vm.successCount).toBe(1)
  })

  it('handles partial failures — successes counted, failed names listed', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [
        makePresentation({ id: 1, name: 'Good Deck' }),
        makePresentation({ id: 2, name: 'Bad Deck' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    convertPresentation
      .mockResolvedValueOnce({ lesson_id: 'l1', question_count: 5 })
      .mockRejectedValueOnce(new Error('Not enough content slides'))

    const wrapper = await mountAndOpen()
    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
      successCount: number
      failedNames: string[]
    }
    vm.toggle(1)
    vm.toggle(2)
    await vm.confirm()
    await flushPromises()

    expect(vm.successCount).toBe(1)
    expect(vm.failedNames).toContain('Bad Deck')
    // The `converted` event should still fire (1 succeeded)
    expect(wrapper.emitted('converted')).toBeTruthy()
  })

  it('shows summary message listing success + failure counts when done', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [
        makePresentation({ id: 1, name: 'Good Deck' }),
        makePresentation({ id: 2, name: 'Bad Deck' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    })
    convertPresentation
      .mockResolvedValueOnce({ lesson_id: 'l1', question_count: 5 })
      .mockRejectedValueOnce(new Error('fail'))

    const wrapper = await mountAndOpen()
    const vm = wrapper.vm as unknown as {
      toggle: (id: number) => void
      confirm: () => Promise<void>
      summaryMessage: string | null
    }
    vm.toggle(1)
    vm.toggle(2)
    await vm.confirm()
    await flushPromises()

    expect(vm.summaryMessage).toContain('1 lesson created')
    expect(vm.summaryMessage).toContain('1 failed')
  })
})
