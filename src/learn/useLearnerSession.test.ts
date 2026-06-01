// WAT-13 (Stage 5) — unit tests for the learner persistence composable.
//
// Anonymous → localStorage (keyed by slug, no network). Name/Email → server-side
// via the courses-api client. Server writes are best-effort: failures must not
// throw (flaky-network requirement).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const startLearner = vi.fn()
const saveLearnerProgress = vi.fn()
const recordLearnerResponse = vi.fn()
vi.mock('@/api/courses-api', () => ({
  startLearner: (...a: unknown[]) => startLearner(...a),
  saveLearnerProgress: (...a: unknown[]) => saveLearnerProgress(...a),
  recordLearnerResponse: (...a: unknown[]) => recordLearnerResponse(...a),
}))

import { createLearnerSession } from './useLearnerSession'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// ── Anonymous (localStorage) ──────────────────────────────────────────────
describe('anonymous session (localStorage)', () => {
  it('starts fresh when nothing is stored', async () => {
    const s = createLearnerSession('slugA', 'anonymous')
    const state = await s.start('')
    expect(state).toEqual({ resumeOrder: 0, completed: false })
    expect(startLearner).not.toHaveBeenCalled()
  })

  it('persists progress to localStorage keyed by slug and resumes from it', async () => {
    const s = createLearnerSession('slugA', 'anonymous')
    await s.start('')
    await s.saveProgress(3)
    expect(JSON.parse(localStorage.getItem('aha-learn:slugA')!)).toEqual({
      currentSlideOrder: 3,
      completed: false,
    })
    // a new session for the same slug resumes
    const s2 = createLearnerSession('slugA', 'anonymous')
    expect(await s2.start('')).toEqual({ resumeOrder: 3, completed: false })
  })

  it('marks completion and a fresh session for a DIFFERENT slug is independent', async () => {
    const a = createLearnerSession('slugA', 'anonymous')
    await a.start('')
    await a.saveProgress(8, true)
    expect(await createLearnerSession('slugA', 'anonymous').start('')).toEqual({
      resumeOrder: 8,
      completed: true,
    })
    expect(await createLearnerSession('slugB', 'anonymous').start('')).toEqual({
      resumeOrder: 0,
      completed: false,
    })
  })

  it('does not hit the server for responses', async () => {
    const s = createLearnerSession('slugA', 'anonymous')
    await s.start('')
    await s.recordResponse(0, { selected: 1 })
    expect(recordLearnerResponse).not.toHaveBeenCalled()
  })

  it('reset clears local progress', async () => {
    const s = createLearnerSession('slugA', 'anonymous')
    await s.start('')
    await s.saveProgress(5, true)
    await s.reset()
    expect(JSON.parse(localStorage.getItem('aha-learn:slugA')!)).toEqual({
      currentSlideOrder: 0,
      completed: false,
    })
  })
})

// ── Server (name/email) ───────────────────────────────────────────────────
describe('server session (name/email)', () => {
  it('starts via the API and returns the resume position', async () => {
    startLearner.mockResolvedValue({ learnerId: 'lr1', currentSlideOrder: 4, completedAt: null })
    const s = createLearnerSession('slugA', 'email')
    const state = await s.start('me@example.com')
    expect(startLearner).toHaveBeenCalledWith('slugA', 'me@example.com')
    expect(state).toEqual({ resumeOrder: 4, completed: false })
  })

  it('treats a completedAt as completed', async () => {
    startLearner.mockResolvedValue({
      learnerId: 'lr1',
      currentSlideOrder: 10,
      completedAt: '2026-06-01T00:00:00Z',
    })
    const s = createLearnerSession('slugA', 'name')
    expect(await s.start('Sam')).toEqual({ resumeOrder: 10, completed: true })
  })

  it('saves progress + records responses against the learner id', async () => {
    startLearner.mockResolvedValue({ learnerId: 'lr9', currentSlideOrder: 0, completedAt: null })
    saveLearnerProgress.mockResolvedValue(undefined)
    recordLearnerResponse.mockResolvedValue(undefined)
    const s = createLearnerSession('slugA', 'name')
    await s.start('Sam')
    await s.saveProgress(2)
    await s.recordResponse(0, { selected: 1, correct: false })
    expect(saveLearnerProgress).toHaveBeenCalledWith('slugA', 'lr9', 2, false)
    expect(recordLearnerResponse).toHaveBeenCalledWith('slugA', 'lr9', 0, { selected: 1, correct: false })
  })

  it('does NOT throw when the server is unreachable (best-effort writes)', async () => {
    startLearner.mockRejectedValue(new Error('offline'))
    const s = createLearnerSession('slugA', 'name')
    // start degrades gracefully to a local resume
    const state = await s.start('Sam')
    expect(state).toEqual({ resumeOrder: 0, completed: false })
    // progress/response swallow errors (no learner id set → early return anyway)
    await expect(s.saveProgress(1)).resolves.toBeUndefined()
    await expect(s.recordResponse(0, {})).resolves.toBeUndefined()
  })

  it('swallows a saveProgress rejection without throwing', async () => {
    startLearner.mockResolvedValue({ learnerId: 'lr1', currentSlideOrder: 0, completedAt: null })
    saveLearnerProgress.mockRejectedValue(new Error('timeout'))
    const s = createLearnerSession('slugA', 'email')
    await s.start('me@example.com')
    await expect(s.saveProgress(3)).resolves.toBeUndefined()
  })
})
