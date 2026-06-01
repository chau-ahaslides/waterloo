/**
 * WAT-13 (Stage 5) — learner persistence layer for the public `/learn/:slug`
 * player. ONE composable that hides WHERE progress lives:
 *
 *   - Anonymous lessons  → localStorage, keyed by slug (no network, no learner row).
 *   - Name / Email lessons → SERVER-SIDE via the public /api/learn/:slug/{start,
 *     progress,response} endpoints, keyed by the learner id the start call returns.
 *
 * The player drives this with three calls — `start()` once (after auth),
 * `saveProgress()` after every navigation, `recordResponse()` on every answer —
 * and reads `resumeOrder` to resume from the last reached slide. All server
 * writes are best-effort: a flaky network must never block the learner (the
 * spec's "short interrupted sessions, flaky networks"), so progress/response
 * failures are swallowed (the local mirror still advances).
 */
import {
  startLearner,
  saveLearnerProgress,
  recordLearnerResponse,
  type AuthMode,
} from '@/api/courses-api'

export interface SessionState {
  /** Slide order to resume from (0 = fresh start). */
  resumeOrder: number
  /** True if the lesson was already completed in a prior session. */
  completed: boolean
}

interface LocalRecord {
  currentSlideOrder: number
  completed: boolean
}

const LS_PREFIX = 'aha-learn:'

function lsKey(slug: string): string {
  return `${LS_PREFIX}${slug}`
}

function readLocal(slug: string): LocalRecord | null {
  try {
    const raw = localStorage.getItem(lsKey(slug))
    if (!raw) return null
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') {
      return {
        currentSlideOrder:
          typeof v.currentSlideOrder === 'number' ? v.currentSlideOrder : 0,
        completed: v.completed === true,
      }
    }
  } catch {
    // corrupt / unavailable storage → start fresh
  }
  return null
}

function writeLocal(slug: string, rec: LocalRecord): void {
  try {
    localStorage.setItem(lsKey(slug), JSON.stringify(rec))
  } catch {
    // storage full / disabled → in-memory only; non-fatal
  }
}

/**
 * Build a session bound to one published lesson. `authMode` decides the backing
 * store; `identifier` is the learner's name/email (ignored for anonymous).
 */
export function createLearnerSession(slug: string, authMode: AuthMode) {
  const isServer = authMode === 'name' || authMode === 'email'
  let learnerId: string | null = null

  /** Begin (or resume) a session; returns where to resume from. */
  async function start(identifier: string): Promise<SessionState> {
    if (isServer) {
      try {
        const res = await startLearner(slug, identifier)
        learnerId = res.learnerId
        return {
          resumeOrder: res.currentSlideOrder ?? 0,
          completed: !!res.completedAt,
        }
      } catch {
        // Server unreachable → degrade to a local-only session so the learner
        // can still take the lesson (progress just won't sync this session).
        const local = readLocal(slug)
        return { resumeOrder: local?.currentSlideOrder ?? 0, completed: local?.completed ?? false }
      }
    }
    const local = readLocal(slug)
    return { resumeOrder: local?.currentSlideOrder ?? 0, completed: local?.completed ?? false }
  }

  /** Persist the learner's current slide (and completion). Best-effort. */
  async function saveProgress(currentSlideOrder: number, completed = false): Promise<void> {
    if (isServer) {
      if (!learnerId) return
      try {
        await saveLearnerProgress(slug, learnerId, currentSlideOrder, completed)
      } catch {
        // swallow — flaky network must not block the learner
      }
      return
    }
    writeLocal(slug, { currentSlideOrder, completed })
  }

  /** Record one answer. Best-effort; anonymous learners don't store responses. */
  async function recordResponse(slideOrder: number, value: unknown): Promise<void> {
    if (isServer && learnerId) {
      try {
        await recordLearnerResponse(slug, learnerId, slideOrder, value)
      } catch {
        // swallow
      }
    }
  }

  /** Reset the run (Take it again). Clears local + server completion/position. */
  async function reset(): Promise<void> {
    if (isServer) {
      await saveProgress(0, false)
    } else {
      writeLocal(slug, { currentSlideOrder: 0, completed: false })
    }
  }

  return { start, saveProgress, recordResponse, reset, isServer }
}

export type LearnerSession = ReturnType<typeof createLearnerSession>
