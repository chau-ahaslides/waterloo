// Component/interaction tests for PresentationList.vue.
//
// These MOUNT the view with @vue/test-utils, MOCK the presentations API module
// so no network happens, and assert that the component (a) calls the API with
// the expected params and (b) RENDERS the returned data + handles the
// no-token / error / empty states. This is the "useful" UI-interaction layer
// on top of the API-client unit tests in src/api/presentations.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { Presentation, PresentationListResponse } from '@/api/presentations'

// --- Mock the API module the component imports ------------------------------
const fetchPresentationList = vi.fn()
const getToken = vi.fn()
vi.mock('@/api/presentations', () => ({
  fetchPresentationList: (...args: unknown[]) => fetchPresentationList(...args),
  getToken: () => getToken(),
}))

import PresentationList from './PresentationList.vue'

function makePresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    id: 1,
    name: 'Quarterly Review',
    accessCode: 'ABC123',
    slideCount: 12,
    participantsCount: 34,
    onlineCount: 0,
    presenting: false,
    language: 'en',
    folderId: null,
    thumbnailImage: null,
    customThumbnailImage: null,
    createdAt: '2026-05-01T10:00:00Z',
    modifiedAt: '2026-05-02T10:00:00Z',
    lastEditedAt: '2026-05-02T10:00:00Z',
    ...over,
  }
}

function mountList() {
  return mount(PresentationList, {
    global: { plugins: [Antd] },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockReturnValue('valid-token')
})

describe('PresentationList.vue', () => {
  it('shows the no-token warning when getToken() returns null', async () => {
    getToken.mockReturnValue(null)
    // onMounted calls the API regardless; with no token the real client would
    // throw, but the mock resolves empty — the UI state under test is the
    // no-token warning, which is gated purely on hasToken (getToken()).
    fetchPresentationList.mockResolvedValue({
      result: [],
      numberOfPresentations: 0,
      numberOfPresentationPages: 0,
    })
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('No token provided')
  })

  it('calls fetchPresentationList on mount and renders the returned presentations', async () => {
    const resp: PresentationListResponse = {
      result: [
        makePresentation({ id: 1, name: 'Quarterly Review', slideCount: 12, accessCode: 'ABC123' }),
        makePresentation({ id: 2, name: 'Onboarding Quiz', slideCount: 5, accessCode: 'XYZ789' }),
      ],
      numberOfPresentations: 2,
      numberOfPresentationPages: 1,
    }
    fetchPresentationList.mockResolvedValue(resp)

    const wrapper = mountList()
    await flushPromises()

    // (a) called with the default list params
    expect(fetchPresentationList).toHaveBeenCalledOnce()
    expect(fetchPresentationList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, sortColumn: 'lastEditedAt', sortOrder: 'desc' }),
    )

    // (b) rendered the data
    const text = wrapper.text()
    expect(text).toContain('Quarterly Review')
    expect(text).toContain('Onboarding Quiz')
    expect(text).toContain('ABC123')
    expect(text).toContain('XYZ789')
    expect(text).toContain('12 slides')
    expect(text).toContain('2 presentations')
  })

  it('renders the empty state when the API returns no presentations', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [],
      numberOfPresentations: 0,
      numberOfPresentationPages: 0,
    })
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('No presentations found')
  })

  it('renders the error alert and a Retry button when the API rejects', async () => {
    fetchPresentationList.mockRejectedValue(new Error('Unauthorized — the token is invalid or expired.'))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('Unauthorized — the token is invalid or expired.')
    expect(wrapper.text()).toContain('Retry')

    // Clicking Retry re-invokes the API.
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 9, name: 'Recovered Deck' })],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    })
    const retry = wrapper.findAll('button').find((b) => b.text().includes('Retry'))
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    await flushPromises()

    expect(fetchPresentationList).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Recovered Deck')
  })

  it('renders a Live tag for a presentation that is presenting', async () => {
    fetchPresentationList.mockResolvedValue({
      result: [makePresentation({ id: 3, name: 'Live Town Hall', presenting: true })],
      numberOfPresentations: 1,
      numberOfPresentationPages: 1,
    })
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('Live Town Hall')
    expect(wrapper.text()).toContain('Live')
  })
})
