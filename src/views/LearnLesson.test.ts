// WAT-13 (Stage 5) — component/interaction tests for the MOBILE-FIRST learner
// experience (LearnLesson.vue) at /learn/:slug.
//
// MOUNT the view with the courses-api + session composable mocked, then drive
// the REAL UI: landing auth per auth_mode (incl. email validation), the
// question → feedback → Continue → explanation → Next question loop, progress,
// completion + retry, persistence resume, and the no-score invariant.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// ── Mocks ──────────────────────────────────────────────────────────────────
const fetchPublishedBySlug = vi.fn()
vi.mock('@/api/courses-api', () => ({
  fetchPublishedBySlug: (slug: string) => fetchPublishedBySlug(slug),
}))

const sessionStart = vi.fn()
const sessionSaveProgress = vi.fn()
const sessionRecordResponse = vi.fn()
const sessionReset = vi.fn()
vi.mock('@/learn/useLearnerSession', () => ({
  createLearnerSession: () => ({
    start: (id: string) => sessionStart(id),
    saveProgress: (o: number, c?: boolean) => sessionSaveProgress(o, c),
    recordResponse: (o: number, v: unknown) => sessionRecordResponse(o, v),
    reset: () => sessionReset(),
    isServer: true,
  }),
}))

let routeSlug = 't9wy9t2t6d'
const routerReplace = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { slug: routeSlug }, query: {} }),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}))

import LearnLesson from './LearnLesson.vue'

// ── Fixtures ─────────────────────────────────────────────────────────────────
function lesson(authMode: 'anonymous' | 'name' | 'email' = 'name') {
  return {
    available: true as const,
    lesson: {
      id: 'l1',
      title: 'Discover Hanoi',
      description: 'A short lesson about Hanoi.',
      estimatedDurationMinutes: 5,
      authMode,
      slides: [
        {
          order: 0,
          type: 'question' as const,
          content: { question: 'Capital of Vietnam?', options: ['Hanoi', 'HCMC', 'Hue', 'Da Nang'], correct_index: 0 },
        },
        { order: 1, type: 'explanation' as const, content: { explanation: 'Hanoi is the capital.' } },
        {
          order: 2,
          type: 'question' as const,
          content: { question: 'Lake in Hanoi?', options: ['Hoan Kiem', 'Como', 'Tahoe', 'Geneva'], correct_index: 0 },
        },
        { order: 3, type: 'explanation' as const, content: { explanation: 'Hoan Kiem Lake.' } },
      ],
    },
  }
}

function freshStart() {
  return { resumeOrder: 0, completed: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  routeSlug = 't9wy9t2t6d'
  sessionStart.mockResolvedValue(freshStart())
  sessionSaveProgress.mockResolvedValue(undefined)
  sessionRecordResponse.mockResolvedValue(undefined)
  sessionReset.mockResolvedValue(undefined)
})

async function mountAndLoad(authMode: 'anonymous' | 'name' | 'email' = 'name') {
  fetchPublishedBySlug.mockResolvedValue(lesson(authMode))
  const wrapper = mount(LearnLesson)
  await flushPromises()
  return wrapper
}

// ── Landing + auth ──────────────────────────────────────────────────────────
describe('landing', () => {
  it('shows title, description, duration and question count', async () => {
    const w = await mountAndLoad('name')
    expect(w.text()).toContain('Discover Hanoi')
    expect(w.text()).toContain('A short lesson about Hanoi.')
    expect(w.text()).toContain('~5 min')
    expect(w.text()).toContain('2 questions')
  })

  it('not-available state for an unknown/unpublished slug', async () => {
    fetchPublishedBySlug.mockResolvedValue({ available: false, error: 'This lesson is not available.' })
    const w = mount(LearnLesson)
    await flushPromises()
    expect(w.text()).toContain('Lesson not available')
    expect(w.text()).toContain('This lesson is not available.')
  })

  it('anonymous mode goes straight to Start (no input)', async () => {
    const w = await mountAndLoad('anonymous')
    expect(w.find('input').exists()).toBe(false)
    expect(w.text()).toContain('Start lesson')
  })

  it('name mode shows a name input', async () => {
    const w = await mountAndLoad('name')
    expect(w.text()).toContain("What's your name?")
    expect(w.find('input[type="text"]').exists()).toBe(true)
  })

  it('email mode shows an email input', async () => {
    const w = await mountAndLoad('email')
    expect(w.text()).toContain("What's your email?")
    expect(w.find('input[type="email"]').exists()).toBe(true)
  })

  it('name mode blocks Start with an empty name', async () => {
    const w = await mountAndLoad('name')
    await w.find('button.cta').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Please enter your name.')
    expect(sessionStart).not.toHaveBeenCalled()
  })

  it('email mode rejects a malformed email and accepts a valid one', async () => {
    const w = await mountAndLoad('email')
    await w.find('input[type="email"]').setValue('not-an-email')
    await w.find('button.cta').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('valid email')
    expect(sessionStart).not.toHaveBeenCalled()

    await w.find('input[type="email"]').setValue('learner@example.com')
    await w.find('button.cta').trigger('click')
    await flushPromises()
    expect(sessionStart).toHaveBeenCalledWith('learner@example.com')
  })
})

// ── Player loop ───────────────────────────────────────────────────────────
describe('player', () => {
  async function startPlayer(authMode: 'anonymous' | 'name' | 'email' = 'anonymous') {
    const w = await mountAndLoad(authMode)
    await w.find('button.cta').trigger('click')
    await flushPromises()
    return w
  }

  it('renders the first question with 4 options + progress', async () => {
    const w = await startPlayer()
    expect(w.text()).toContain('Capital of Vietnam?')
    expect(w.findAll('button.option')).toHaveLength(4)
    expect(w.text()).toContain('Slide 1 of 4')
  })

  it('tapping the correct option shows correct feedback (no score) + Continue', async () => {
    const w = await startPlayer()
    await w.findAll('button.option')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Correct!')
    expect(w.text()).toContain('Continue')
    // records the response + saves progress
    expect(sessionRecordResponse).toHaveBeenCalledWith(0, { selected: 0, correct: true })
    expect(sessionSaveProgress).toHaveBeenCalled()
  })

  it('tapping a wrong option shows incorrect feedback', async () => {
    const w = await startPlayer()
    await w.findAll('button.option')[1].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Not quite.')
    expect(sessionRecordResponse).toHaveBeenCalledWith(0, { selected: 1, correct: false })
  })

  it('locks the selection after the first tap', async () => {
    const w = await startPlayer()
    const opts = w.findAll('button.option')
    await opts[1].trigger('click')
    await flushPromises()
    // a second tap on a different option does not change feedback
    await opts[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Not quite.')
  })

  it('Continue advances to the explanation, then Next question advances to Q2', async () => {
    const w = await startPlayer()
    await w.findAll('button.option')[0].trigger('click')
    await flushPromises()
    await w.find('button.cta').trigger('click') // Continue
    await flushPromises()
    expect(w.text()).toContain('Hanoi is the capital.')
    expect(w.text()).toContain('Next question')
    expect(w.text()).toContain('Slide 2 of 4')

    await w.find('button.cta').trigger('click') // Next question
    await flushPromises()
    expect(w.text()).toContain('Lake in Hanoi?')
    expect(w.text()).toContain('Slide 3 of 4')
  })

  it('never shows a score, points, or leaderboard anywhere in the flow', async () => {
    const w = await startPlayer()
    await w.findAll('button.option')[0].trigger('click')
    await flushPromises()
    const t = w.text().toLowerCase()
    expect(t).not.toContain('score')
    expect(t).not.toContain('points')
    expect(t).not.toContain('leaderboard')
  })

  it('reaches the completion screen after the last slide and offers Take it again', async () => {
    const w = await startPlayer()
    // Q1 → feedback → Continue → E1 → Next → Q2 → feedback → Continue → E2 → Next → completion
    await w.findAll('button.option')[0].trigger('click')
    await flushPromises()
    await w.find('button.cta').trigger('click') // Continue → E1
    await flushPromises()
    await w.find('button.cta').trigger('click') // Next → Q2
    await flushPromises()
    await w.findAll('button.option')[0].trigger('click')
    await flushPromises()
    await w.find('button.cta').trigger('click') // Continue → E2
    await flushPromises()
    await w.find('button.cta').trigger('click') // Next → completion
    await flushPromises()
    expect(w.text()).toContain('All done!')
    expect(w.text()).toContain('Take it again')
    expect(sessionSaveProgress).toHaveBeenCalledWith(4, true)
  })

  it('Take it again resets to slide 1', async () => {
    const w = await startPlayer()
    // race to completion
    await w.findAll('button.option')[0].trigger('click'); await flushPromises()
    await w.find('button.cta').trigger('click'); await flushPromises()
    await w.find('button.cta').trigger('click'); await flushPromises()
    await w.findAll('button.option')[0].trigger('click'); await flushPromises()
    await w.find('button.cta').trigger('click'); await flushPromises()
    await w.find('button.cta').trigger('click'); await flushPromises()
    expect(w.text()).toContain('All done!')
    await w.find('button.cta').trigger('click') // Take it again
    await flushPromises()
    expect(sessionReset).toHaveBeenCalled()
    expect(w.text()).toContain('Slide 1 of 4')
    expect(w.text()).toContain('Capital of Vietnam?')
  })
})

// ── Persistence resume ────────────────────────────────────────────────────
describe('resume', () => {
  it('resumes from the last reached slide reported by start()', async () => {
    sessionStart.mockResolvedValue({ resumeOrder: 2, completed: false })
    const w = await mountAndLoad('name')
    await w.find('input').setValue('Sam')
    await w.find('button.cta').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Slide 3 of 4')
    expect(w.text()).toContain('Lake in Hanoi?')
  })

  it('lands on completion if the lesson was already finished', async () => {
    sessionStart.mockResolvedValue({ resumeOrder: 4, completed: true })
    const w = await mountAndLoad('name')
    await w.find('input').setValue('Sam')
    await w.find('button.cta').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('All done!')
  })
})
