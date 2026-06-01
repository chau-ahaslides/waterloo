// WAT-11 — component tests for the lesson detail / editor page.
//
// The API client is mocked so we test the editor's behavior in isolation:
// inline edits emit a save, reorder keeps Q+E pairs together (and calls the
// reorder endpoint with the new question id order), delete enforces the min-3
// rule client-side, regenerate buttons call their endpoints, and the reviewed
// flag is set on page open.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Antd from 'ant-design-vue'

// ── Mock the router ──────────────────────────────────────────────────────────
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'lesson-1' }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

// ── Mock the API client ──────────────────────────────────────────────────────
const api = {
  fetchLessonDetail: vi.fn(),
  saveLessonDetail: vi.fn(),
  reorderLesson: vi.fn(),
  deleteQuestionPair: vi.fn(),
  regenerateQuestion: vi.fn(),
  regenerateLesson: vi.fn(),
  markLessonReviewed: vi.fn(),
  fetchPublishState: vi.fn(),
  setLessonAuthMode: vi.fn(),
  publishLesson: vi.fn(),
  updatePublishedLesson: vi.fn(),
  unpublishLesson: vi.fn(),
}
vi.mock('@/api/courses-api', () => ({
  fetchLessonDetail: (...a: unknown[]) => api.fetchLessonDetail(...a),
  saveLessonDetail: (...a: unknown[]) => api.saveLessonDetail(...a),
  reorderLesson: (...a: unknown[]) => api.reorderLesson(...a),
  deleteQuestionPair: (...a: unknown[]) => api.deleteQuestionPair(...a),
  regenerateQuestion: (...a: unknown[]) => api.regenerateQuestion(...a),
  regenerateLesson: (...a: unknown[]) => api.regenerateLesson(...a),
  markLessonReviewed: (...a: unknown[]) => api.markLessonReviewed(...a),
  fetchPublishState: (...a: unknown[]) => api.fetchPublishState(...a),
  setLessonAuthMode: (...a: unknown[]) => api.setLessonAuthMode(...a),
  publishLesson: (...a: unknown[]) => api.publishLesson(...a),
  updatePublishedLesson: (...a: unknown[]) => api.updatePublishedLesson(...a),
  unpublishLesson: (...a: unknown[]) => api.unpublishLesson(...a),
}))

function publishState(over: Record<string, unknown> = {}) {
  return {
    id: 'lesson-1',
    status: 'draft',
    reviewed: true,
    authMode: 'name',
    shareLinkSlug: null,
    publishedAt: null,
    hasDraftChanges: false,
    ...over,
  }
}

import CourseLessonDetail from './CourseLessonDetail.vue'

function makeSlides(n: number) {
  const slides: Array<{ id: string; order: number; type: string; content: Record<string, unknown> }> = []
  let order = 0
  for (let i = 0; i < n; i++) {
    slides.push({
      id: `q${i}`,
      order: order++,
      type: 'question',
      content: { question: `Q${i}?`, options: ['a', 'b', 'c', 'd'], correct_index: 0 },
    })
    slides.push({ id: `e${i}`, order: order++, type: 'explanation', content: { explanation: `E${i}.` } })
  }
  return slides
}

function detail(n: number, reviewed = false) {
  return {
    lesson: {
      id: 'lesson-1',
      title: 'My Lesson',
      status: 'draft',
      sourcePresentationId: 42,
      estimatedDurationMinutes: 10,
      language: 'en',
      reviewed,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    slides: makeSlides(n),
  }
}

async function mountReady(n: number, reviewed = false, pubOver: Record<string, unknown> = {}) {
  api.fetchLessonDetail.mockResolvedValue(detail(n, reviewed))
  api.markLessonReviewed.mockResolvedValue(detail(n, true))
  api.fetchPublishState.mockResolvedValue(publishState({ reviewed, ...pubOver }))
  const wrapper = mount(CourseLessonDetail, { global: { plugins: [Antd] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('CourseLessonDetail.vue', () => {
  it('marks the lesson reviewed on first open', async () => {
    await mountReady(5, false)
    expect(api.markLessonReviewed).toHaveBeenCalledWith('lesson-1')
  })

  it('does NOT re-mark reviewed if already reviewed', async () => {
    await mountReady(5, true)
    expect(api.markLessonReviewed).not.toHaveBeenCalled()
  })

  it('renders one card per question (Q+E grouped)', async () => {
    const wrapper = await mountReady(4)
    const cards = wrapper.findAll('[data-pair-index]')
    expect(cards).toHaveLength(4)
    expect(wrapper.text()).toContain('Question 1')
    expect(wrapper.text()).toContain('Question 4')
  })

  it('auto-suggests duration from the slide count', async () => {
    const wrapper = await mountReady(5)
    // 5 questions → 10 slides → ~5 min suggested; the input reflects loaded value (10).
    expect(wrapper.text()).toContain('Auto-suggested from 5 questions')
  })

  it('editing a question and clicking Save calls saveLessonDetail with edited content', async () => {
    api.saveLessonDetail.mockImplementation((_id: string, patch: any) =>
      Promise.resolve(detail(4)),
    )
    const wrapper = await mountReady(4)
    const firstCard = wrapper.findAll('[data-pair-index]')[0]
    const qTextarea = firstCard.find('textarea')
    await qTextarea.setValue('Edited question?')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('Save draft'))
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(api.saveLessonDetail).toHaveBeenCalled()
    const patch = api.saveLessonDetail.mock.calls.at(-1)![1]
    const editedSlide = patch.slides.find((s: any) => s.id === 'q0')
    expect(editedSlide.content.question).toBe('Edited question?')
  })

  it('moving a pair down calls reorder with the new question id order', async () => {
    api.reorderLesson.mockResolvedValue(detail(3))
    const wrapper = await mountReady(3) // q0,q1,q2
    const firstCard = wrapper.findAll('[data-pair-index]')[0]
    const downBtn = firstCard.find('.reorder-down')
    await downBtn.trigger('click')
    await flushPromises()

    expect(api.reorderLesson).toHaveBeenCalledWith('lesson-1', ['q1', 'q0', 'q2'])
  })

  it('blocks deleting when at the minimum of 3 questions', async () => {
    const wrapper = await mountReady(3)
    const firstCard = wrapper.findAll('[data-pair-index]')[0]
    const delBtn = firstCard.find('.delete-pair')
    await delBtn.trigger('click')
    await flushPromises()
    // No confirm modal / no delete call — blocked client-side.
    expect(api.deleteQuestionPair).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('minimum of 3 questions')
  })

  it('regenerate-one button calls regenerateQuestion for that pair order', async () => {
    api.regenerateQuestion.mockResolvedValue(detail(4))
    const wrapper = await mountReady(4)
    const secondCard = wrapper.findAll('[data-pair-index]')[1]
    const regenBtn = secondCard.find('.regen-one')
    await regenBtn.trigger('click')
    await flushPromises()
    // Second question is at order 2 (q0=0,e0=1,q1=2,…).
    expect(api.regenerateQuestion).toHaveBeenCalledWith('lesson-1', 2)
  })

  it('shows a load error with retry', async () => {
    api.fetchLessonDetail.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(CourseLessonDetail, { global: { plugins: [Antd] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load lesson')
  })

  // ── Publishing (WAT-12) ────────────────────────────────────────────────────

  it('disables Publish while the lesson is not reviewed', async () => {
    // Auto-review-on-open fails → the lesson stays unreviewed → publish disabled.
    api.fetchLessonDetail.mockResolvedValue(detail(3, false))
    api.markLessonReviewed.mockRejectedValue(new Error('offline'))
    api.fetchPublishState.mockResolvedValue(publishState({ reviewed: false }))
    const wrapper = mount(CourseLessonDetail, { global: { plugins: [Antd] } })
    await flushPromises()
    const btn = wrapper.find('button.publish-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(api.publishLesson).not.toHaveBeenCalled()
  })

  it('enables Publish once reviewed and shows the link modal on publish', async () => {
    api.publishLesson.mockResolvedValue(
      publishState({ status: 'published', shareLinkSlug: 'abc123', publishedAt: '2026-06-01T00:00:00Z' }),
    )
    const wrapper = await mountReady(3, true)
    const btn = wrapper.find('button.publish-btn')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    await flushPromises()
    expect(api.publishLesson).toHaveBeenCalledWith('lesson-1', 'name')
    // Modal renders into body (teleport) — assert on document.
    expect(document.body.textContent).toContain('ahaslides.com/learn/abc123')
  })

  it('changing the auth-mode selector calls setLessonAuthMode', async () => {
    api.setLessonAuthMode.mockResolvedValue(publishState({ authMode: 'email' }))
    const wrapper = await mountReady(3, true)
    const emailRadio = wrapper
      .findAll('.auth-mode-group input')
      .find((_i, idx) => idx === 2)
    // Fallback: find by label text.
    const labels = wrapper.findAll('.auth-mode-group label')
    const emailLabel = labels.find((l) => l.text().includes('Email'))
    await emailLabel!.find('input').setValue(true)
    await flushPromises()
    expect(api.setLessonAuthMode).toHaveBeenCalledWith('lesson-1', 'email')
    void emailRadio
  })

  it('shows Update published + Unpublish when published with draft changes', async () => {
    const wrapper = await mountReady(3, true, {
      status: 'published',
      shareLinkSlug: 'abc123',
      hasDraftChanges: true,
    })
    expect(wrapper.find('.update-published-btn').exists()).toBe(true)
    expect(wrapper.find('.unpublish-btn').exists()).toBe(true)
    expect(wrapper.find('.view-link-btn').exists()).toBe(true)
    // Not the bare Publish button anymore.
    expect(wrapper.find('.publish-btn').exists()).toBe(false)
  })

  it('Update published version calls updatePublishedLesson', async () => {
    api.updatePublishedLesson.mockResolvedValue(
      publishState({ status: 'published', shareLinkSlug: 'abc123', hasDraftChanges: false }),
    )
    const wrapper = await mountReady(3, true, {
      status: 'published',
      shareLinkSlug: 'abc123',
      hasDraftChanges: true,
    })
    await wrapper.find('button.update-published-btn').trigger('click')
    await flushPromises()
    expect(api.updatePublishedLesson).toHaveBeenCalledWith('lesson-1')
  })

  it('copy button writes the working URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    api.publishLesson.mockResolvedValue(
      publishState({ status: 'published', shareLinkSlug: 'abc123' }),
    )
    const wrapper = await mountReady(3, true)
    await wrapper.find('button.publish-btn').trigger('click')
    await flushPromises()
    // The copy button is in the modal (teleported); query the document.
    const copyBtn = Array.from(document.querySelectorAll('.copy-link-btn')).at(-1) as HTMLElement
    expect(copyBtn).toBeTruthy()
    copyBtn.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/learn/abc123`)
  })
})
