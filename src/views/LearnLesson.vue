<script setup lang="ts">
/**
 * WAT-13 (Stage 5) — PUBLIC, MOBILE-FIRST learner experience at /learn/:slug.
 *
 * The whole point is a NATIVE-feeling phone experience for a self-paced learner
 * (PROJECT-THESIS core: "Learners complete them at their own pace") on short,
 * interrupted sessions over flaky networks. Base styles target a 375px viewport;
 * larger screens are progressive enhancement via min-width media queries.
 *
 * Phases:
 *   - loading        → spinner.
 *   - not-available  → unknown / unpublished slug (WAT-12 contract).
 *   - landing        → title + description + duration + auth flow + Start.
 *   - player         → ONE slide full-screen; questions show 4 tappable options,
 *                      then correct/incorrect feedback (NO score/points), then a
 *                      sticky-bottom Continue → explanation → Next question.
 *   - completion     → done screen + "Take it again" (unlimited retry).
 *
 * Persistence (createLearnerSession): anonymous → localStorage by slug;
 * name/email → server-side. Progress is saved after EVERY action; reopening the
 * link resumes from the last reached slide.
 *
 * NO leaderboard, NO points, NO score is shown anywhere — by design.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchPublishedBySlug, type PublishedLesson, type PublishedSlide } from '@/api/courses-api'
import { createLearnerSession, type LearnerSession } from '@/learn/useLearnerSession'

const route = useRoute()
const slug = route.params.slug as string

type Phase = 'loading' | 'not-available' | 'landing' | 'player' | 'completion'
const phase = ref<Phase>('loading')
const notAvailableMessage = ref('This lesson is not available.')
const lesson = ref<PublishedLesson | null>(null)
let session: LearnerSession | null = null

// ── Landing / auth ──────────────────────────────────────────────────────────
const identifier = ref('')
const authError = ref('')
const starting = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const authMode = computed(() => lesson.value?.authMode ?? 'name')

const questionCount = computed(
  () => lesson.value?.slides.filter((s) => s.type === 'question').length ?? 0,
)

function validateAuth(): boolean {
  authError.value = ''
  const mode = authMode.value
  if (mode === 'anonymous') return true
  const val = identifier.value.trim()
  if (!val) {
    authError.value = mode === 'email' ? 'Please enter your email.' : 'Please enter your name.'
    return false
  }
  if (mode === 'email' && !EMAIL_RE.test(val)) {
    authError.value = 'Please enter a valid email address.'
    return false
  }
  return true
}

// ── Player state ──────────────────────────────────────────────────────────
const slideIndex = ref(0)
// For a question slide: 'asking' (options live) | 'feedback' (locked + result).
const questionPhase = ref<'asking' | 'feedback'>('asking')
const selectedOption = ref<number | null>(null)

const slides = computed<PublishedSlide[]>(() => lesson.value?.slides ?? [])
const totalSlides = computed(() => slides.value.length)
const currentSlide = computed<PublishedSlide | null>(() => slides.value[slideIndex.value] ?? null)

const questionText = computed(() => {
  const c = currentSlide.value?.content
  return c && typeof c.question === 'string' ? c.question : ''
})
const options = computed<string[]>(() => {
  const c = currentSlide.value?.content
  return c && Array.isArray(c.options) ? (c.options as string[]) : []
})
const correctIndex = computed<number>(() => {
  const c = currentSlide.value?.content
  return c && typeof c.correct_index === 'number' ? c.correct_index : -1
})
const explanationText = computed(() => {
  const c = currentSlide.value?.content
  return c && typeof c.explanation === 'string' ? c.explanation : ''
})

const isQuestion = computed(() => currentSlide.value?.type === 'question')
const isCorrect = computed(
  () => selectedOption.value !== null && selectedOption.value === correctIndex.value,
)
// 1-based slide position for the progress indicator.
const progressNumber = computed(() => Math.min(slideIndex.value + 1, totalSlides.value))
const progressPct = computed(() =>
  totalSlides.value > 0 ? Math.round((progressNumber.value / totalSlides.value) * 100) : 0,
)

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(async () => {
  const result = await fetchPublishedBySlug(slug)
  if (!result.available) {
    notAvailableMessage.value = result.error
    phase.value = 'not-available'
    return
  }
  lesson.value = result.lesson
  session = createLearnerSession(slug, result.lesson.authMode)
  phase.value = 'landing'
})

// ── Actions ─────────────────────────────────────────────────────────────────
async function startLesson(): Promise<void> {
  if (!validateAuth() || !session) return
  starting.value = true
  try {
    const state = await session.start(identifier.value.trim())
    if (state.completed && state.resumeOrder >= totalSlides.value) {
      // Finished before — land on the completion screen; they can retake.
      phase.value = 'completion'
      return
    }
    resumeAt(state.resumeOrder)
    phase.value = 'player'
  } finally {
    starting.value = false
  }
}

/** Position the player at a resume order, normalizing into a clean slide phase. */
function resumeAt(order: number): void {
  const idx = Math.max(0, Math.min(order, Math.max(0, totalSlides.value - 1)))
  slideIndex.value = idx
  selectedOption.value = null
  questionPhase.value = 'asking'
}

async function pickOption(i: number): Promise<void> {
  if (questionPhase.value === 'feedback') return // locked
  selectedOption.value = i
  questionPhase.value = 'feedback'
  // Record the answer + save position (best-effort; never blocks the UI).
  void session?.recordResponse(currentSlide.value?.order ?? slideIndex.value, {
    selected: i,
    correct: i === correctIndex.value,
  })
  void session?.saveProgress(slideIndex.value)
}

async function continueToExplanation(): Promise<void> {
  advance()
}

async function nextQuestion(): Promise<void> {
  advance()
}

/** Advance one slide; if past the last slide, complete. */
function advance(): void {
  const next = slideIndex.value + 1
  if (next >= totalSlides.value) {
    phase.value = 'completion'
    void session?.saveProgress(totalSlides.value, true)
    return
  }
  slideIndex.value = next
  selectedOption.value = null
  questionPhase.value = 'asking'
  void session?.saveProgress(next)
}

async function takeAgain(): Promise<void> {
  await session?.reset()
  slideIndex.value = 0
  selectedOption.value = null
  questionPhase.value = 'asking'
  phase.value = 'player'
}

/** Classes for an option button reflecting the locked feedback state. */
function optionClass(i: number): string {
  if (questionPhase.value !== 'feedback') return 'option'
  if (i === correctIndex.value) return 'option option--correct'
  if (i === selectedOption.value) return 'option option--wrong'
  return 'option option--muted'
}
</script>

<template>
  <main class="learn">
    <!-- Loading -->
    <section v-if="phase === 'loading'" class="screen screen--center" aria-busy="true">
      <div class="spinner" role="status" aria-label="Loading lesson"></div>
    </section>

    <!-- Not available -->
    <section v-else-if="phase === 'not-available'" class="screen screen--center">
      <div class="card">
        <div class="emoji" aria-hidden="true">😕</div>
        <h1 class="title">Lesson not available</h1>
        <p class="muted">{{ notAvailableMessage }}</p>
      </div>
    </section>

    <!-- Landing + auth -->
    <section v-else-if="phase === 'landing' && lesson" class="screen landing">
      <div class="landing__body">
        <p class="eyebrow">Lesson</p>
        <h1 class="title title--lg">{{ lesson.title || 'Untitled lesson' }}</h1>
        <p v-if="lesson.description" class="lead">{{ lesson.description }}</p>
        <ul class="meta">
          <li>{{ questionCount }} {{ questionCount === 1 ? 'question' : 'questions' }}</li>
          <li v-if="lesson.estimatedDurationMinutes">
            ~{{ lesson.estimatedDurationMinutes }} min
          </li>
          <li>Self-paced</li>
        </ul>

        <form class="auth" @submit.prevent="startLesson">
          <label v-if="authMode === 'name'" class="field">
            <span class="field__label">What's your name?</span>
            <input
              v-model="identifier"
              class="input"
              type="text"
              autocomplete="name"
              inputmode="text"
              placeholder="Your name"
              :aria-invalid="!!authError"
            />
          </label>
          <label v-else-if="authMode === 'email'" class="field">
            <span class="field__label">What's your email?</span>
            <input
              v-model="identifier"
              class="input"
              type="email"
              autocomplete="email"
              inputmode="email"
              placeholder="you@example.com"
              :aria-invalid="!!authError"
            />
          </label>
          <p v-if="authError" class="error" role="alert">{{ authError }}</p>
        </form>
      </div>

      <div class="actionbar">
        <button class="cta" type="button" :disabled="starting" @click="startLesson">
          {{ starting ? 'Starting…' : 'Start lesson' }}
        </button>
      </div>
    </section>

    <!-- Player -->
    <section v-else-if="phase === 'player' && currentSlide" class="screen player">
      <header class="progress">
        <div class="progress__bar" aria-hidden="true">
          <div class="progress__fill" :style="{ width: progressPct + '%' }"></div>
        </div>
        <p class="progress__label">Slide {{ progressNumber }} of {{ totalSlides }}</p>
      </header>

      <!-- Question -->
      <div v-if="isQuestion" class="slide">
        <h2 class="question">{{ questionText }}</h2>
        <div class="options">
          <button
            v-for="(opt, i) in options"
            :key="i"
            type="button"
            :class="optionClass(i)"
            :disabled="questionPhase === 'feedback'"
            :aria-pressed="selectedOption === i"
            @click="pickOption(i)"
          >
            <span class="option__text">{{ opt }}</span>
            <span
              v-if="questionPhase === 'feedback' && i === correctIndex"
              class="option__icon"
              aria-hidden="true"
              >✓</span
            >
            <span
              v-else-if="questionPhase === 'feedback' && i === selectedOption"
              class="option__icon"
              aria-hidden="true"
              >✕</span
            >
          </button>
        </div>

        <p
          v-if="questionPhase === 'feedback'"
          :class="['feedback', isCorrect ? 'feedback--correct' : 'feedback--wrong']"
          role="status"
        >
          {{ isCorrect ? 'Correct!' : 'Not quite.' }}
        </p>
      </div>

      <!-- Explanation -->
      <div v-else class="slide">
        <p class="eyebrow">Explanation</p>
        <p class="explanation">{{ explanationText }}</p>
      </div>

      <div class="actionbar">
        <button
          v-if="isQuestion && questionPhase === 'feedback'"
          class="cta"
          type="button"
          @click="continueToExplanation"
        >
          Continue
        </button>
        <button v-else-if="!isQuestion" class="cta" type="button" @click="nextQuestion">
          Next question
        </button>
        <p v-else class="actionbar__hint">Tap an answer to continue</p>
      </div>
    </section>

    <!-- Completion -->
    <section v-else-if="phase === 'completion'" class="screen completion">
      <div class="completion__body">
        <div class="emoji emoji--lg" aria-hidden="true">🎉</div>
        <h1 class="title title--lg">All done!</h1>
        <p class="lead">You've completed the lesson. Nice work.</p>
      </div>
      <div class="actionbar">
        <button class="cta" type="button" @click="takeAgain">Take it again</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ── MOBILE-FIRST (base = 375px viewport) ──────────────────────────────────
 * Base text >=16px (prevents iOS input zoom), full-screen slide layout, sticky
 * thumb-reachable action bar, 44px+ touch targets, brand colours at AA contrast.
 * Larger screens are progressive enhancement via min-width media queries below.
 */
.learn {
  font-family:
    'Plus Jakarta Sans',
    system-ui,
    -apple-system,
    sans-serif;
  color: #1a1a2e; /* Deep Space Blue — AA on white */
  background: #ffffff;
  min-height: 100vh;
  min-height: 100dvh;
}

.screen {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
}
.screen--center {
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* Spinner */
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f0f4ff;
  border-top-color: #6a1ebb; /* Violet Purple */
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.card {
  text-align: center;
  max-width: 420px;
}
.emoji {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 12px;
}
.emoji--lg {
  font-size: 56px;
  margin-bottom: 16px;
}

.title {
  font-weight: 800;
  font-size: 22px;
  line-height: 1.25;
  margin: 0 0 8px;
}
.title--lg {
  font-size: 26px;
}
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 13px;
  font-weight: 700;
  color: #6a1ebb;
  margin: 0 0 6px;
}
.lead {
  font-size: 16px;
  line-height: 1.5;
  color: #3e3e5a; /* Muted Indigo — AA on white */
  margin: 0 0 16px;
}
.muted {
  font-size: 16px;
  color: #3e3e5a;
  margin: 0;
}

/* ── Landing ──────────────────────────────────────────────────────────────*/
.landing {
  padding: 24px 20px 0;
}
.landing__body {
  flex: 1;
  padding-bottom: 24px;
}
.meta {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0 0 28px;
}
.meta li {
  font-size: 14px;
  font-weight: 600;
  color: #3e3e5a;
  background: #f0f4ff;
  border-radius: 999px;
  padding: 6px 12px;
}

.auth {
  margin-top: 8px;
}
.field {
  display: block;
}
.field__label {
  display: block;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
}
.input {
  width: 100%;
  box-sizing: border-box;
  font-size: 16px; /* >=16px prevents iOS zoom */
  font-family: inherit;
  padding: 14px 16px;
  min-height: 52px;
  border: 2px solid #d9def0;
  border-radius: 12px;
  color: #1a1a2e;
  background: #ffffff;
}
.input:focus {
  outline: none;
  border-color: #6a1ebb;
  box-shadow: 0 0 0 3px rgba(106, 30, 187, 0.18);
}
.error {
  color: #c20050; /* darker carmine for AA on white */
  font-size: 15px;
  font-weight: 600;
  margin: 10px 0 0;
}

/* ── Player ───────────────────────────────────────────────────────────────*/
.player {
  padding: 0;
}
.progress {
  padding: 16px 20px 8px;
}
.progress__bar {
  height: 8px;
  background: #f0f4ff;
  border-radius: 999px;
  overflow: hidden;
}
.progress__fill {
  height: 100%;
  background: #6a1ebb;
  border-radius: 999px;
  transition: width 0.25s ease;
}
.progress__label {
  font-size: 14px;
  font-weight: 600;
  color: #3e3e5a;
  margin: 8px 0 0;
}

.slide {
  flex: 1;
  padding: 12px 20px 24px;
  overflow-y: auto;
}
.question {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.3;
  margin: 8px 0 24px;
}
.explanation {
  font-size: 17px;
  line-height: 1.6;
  color: #1a1a2e;
  margin: 0;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 56px; /* >44px touch target */
  text-align: left;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
  background: #ffffff;
  border: 2px solid #d9def0;
  border-radius: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.option:active {
  background: #f0f4ff;
}
.option:focus-visible {
  outline: none;
  border-color: #6a1ebb;
  box-shadow: 0 0 0 3px rgba(106, 30, 187, 0.18);
}
.option__text {
  flex: 1;
}
.option__icon {
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
}
/* Feedback: teal (correct) / carmine (wrong). Tinted bg + coloured border +
 * icon so it does NOT rely on colour alone (WCAG). */
.option--correct {
  border-color: #0f9b78;
  background: #e6fbf4;
  color: #0a6e55;
}
.option--correct .option__icon {
  color: #0f9b78;
}
.option--wrong {
  border-color: #c20050;
  background: #fdecf2;
  color: #9c0040;
}
.option--wrong .option__icon {
  color: #c20050;
}
.option--muted {
  opacity: 0.55;
}

.feedback {
  font-size: 18px;
  font-weight: 800;
  margin: 20px 0 0;
}
.feedback--correct {
  color: #0a6e55;
}
.feedback--wrong {
  color: #9c0040;
}

/* ── Sticky bottom action bar (thumb-reachable primary CTA) ────────────────*/
.actionbar {
  position: sticky;
  bottom: 0;
  padding: 16px 20px calc(16px + env(safe-area-inset-bottom));
  background: #ffffff;
  border-top: 1px solid #ececf2;
}
.cta {
  width: 100%;
  min-height: 54px;
  font-family: inherit;
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
  background: #6a1ebb; /* Violet Purple — primary CTA, AA on white */
  border: none;
  border-radius: 14px;
  cursor: pointer;
}
.cta:active {
  background: #5a189a;
}
.cta:disabled {
  opacity: 0.6;
  cursor: default;
}
.cta:focus-visible {
  outline: 3px solid #1a1a2e;
  outline-offset: 2px;
}
.actionbar__hint {
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #3e3e5a;
  margin: 0;
  padding: 16px 0;
}

/* ── Completion ───────────────────────────────────────────────────────────*/
.completion {
  padding: 24px 20px 0;
}
.completion__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* ── Progressive enhancement: larger screens ──────────────────────────────*/
@media (min-width: 600px) {
  .landing__body,
  .slide,
  .progress,
  .actionbar,
  .completion__body {
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
  .actionbar {
    border-top: none;
  }
  .cta {
    border-radius: 16px;
  }
  .title--lg {
    font-size: 32px;
  }
  .question {
    font-size: 26px;
  }
}
</style>
