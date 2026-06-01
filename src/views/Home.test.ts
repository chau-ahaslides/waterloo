// Component/interaction tests for Home.vue (My Lessons).
//
// MOUNT the view, MOCK the lessons store + token, and assert the rendered
// states: welcome/empty when there are no lessons, the lessons grid when there
// are, and that the Preview button routes to the lesson-play view. ConverterModal
// is stubbed so we don't pull the API into this test.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Lesson } from '@/lessons/lessons'

// --- Mock the lessons API + token ------------------------------------------
const fetchLessons = vi.fn()
const deleteLesson = vi.fn()
vi.mock('@/api/lessons-api', () => ({
  fetchLessons: () => fetchLessons(),
  deleteLesson: (id: string) => deleteLesson(id),
}))

const getToken = vi.fn()
vi.mock('@/api/presentations', () => ({
  getToken: () => getToken(),
}))

// --- Mock vue-router so useRoute/useRouter/RouterLink resolve --------------
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { token: 'abc' } }),
  useRouter: () => ({ push }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

import Home from './Home.vue'

function makeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'lesson_1',
    presentationId: 42,
    title: 'Cell Biology Basics',
    description: '',
    status: 'draft',
    createdAt: '2026-05-20T09:00:00Z',
    updatedAt: '2026-05-20T09:00:00Z',
    publishedAt: null,
    slides: [
      { id: 1, type: 'pickAnswer', question: 'Q1', options: [{ id: 1, text: 'A', isCorrect: true }] },
      { id: 2, type: 'pickAnswer', question: 'Q2', options: [{ id: 2, text: 'B', isCorrect: false }] },
    ],
    ...over,
  }
}

function mountHome() {
  return mount(Home, {
    global: {
      plugins: [Antd],
      stubs: { ConverterModal: true },
      // The template references the `$route` global property (injected by the
      // vue-router plugin in the real app); provide it since router is mocked.
      mocks: { $route: { query: { token: 'abc' } } },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockReturnValue('valid-token')
  fetchLessons.mockResolvedValue([])
})

describe('Home.vue', () => {
  it('shows the no-token warning when there is no token', async () => {
    getToken.mockReturnValue(null)
    const wrapper = mountHome()
    await flushPromises()

    expect(wrapper.text()).toContain('No token provided')
  })

  it('shows the welcome/empty state when the store has no lessons', async () => {
    fetchLessons.mockResolvedValue([])
    const wrapper = mountHome()
    await flushPromises()

    expect(fetchLessons).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Welcome!')
    expect(wrapper.text()).toContain('0 lessons')
  })

  it('renders the lessons grid from the store (title, question count, id tag)', async () => {
    fetchLessons.mockResolvedValue([
      makeLesson({ id: 'l1', title: 'Cell Biology Basics', presentationId: 42 }),
      makeLesson({
        id: 'l2',
        title: 'World Capitals',
        presentationId: 7,
        slides: [{ id: 9, type: 'pickAnswer', question: 'Q', options: [] }],
      }),
    ])
    const wrapper = mountHome()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Cell Biology Basics')
    expect(text).toContain('World Capitals')
    expect(text).toContain('2 slides') // Cell Biology has 2 slides
    expect(text).toContain('1 slide') // World Capitals has 1 slide
    expect(text).toContain('#42')
    expect(text).toContain('#7')
    expect(text).toContain('2 lessons')
  })

  it('Preview button pushes to the lesson-play route with the lesson id + query', async () => {
    fetchLessons.mockResolvedValue([makeLesson({ id: 'l1', title: 'Cell Biology Basics' })])
    const wrapper = mountHome()
    await flushPromises()

    const preview = wrapper.findAll('button').find((b) => b.text().includes('Preview'))
    expect(preview).toBeTruthy()
    await preview!.trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'lesson-play',
      params: { id: 'l1' },
      query: { token: 'abc' },
    })
  })

  it('confirming the delete popconfirm removes the lesson via the store', async () => {
    fetchLessons.mockResolvedValue([makeLesson({ id: 'l1', title: 'Cell Biology Basics' })])
    deleteLesson.mockResolvedValue(undefined)
    const wrapper = mountHome()
    await flushPromises()

    // The component calls removeLesson(id) → deleteLesson(id) on popconfirm
    // confirm. Invoke the handler path directly via the component method to
    // avoid driving the floating popconfirm overlay.
    ;(wrapper.vm as unknown as { removeLesson: (id: string) => void }).removeLesson('l1')
    await flushPromises()

    expect(deleteLesson).toHaveBeenCalledWith('l1')
    expect(wrapper.text()).toContain('Welcome!') // back to empty state
  })
})
