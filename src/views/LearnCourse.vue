<script setup lang="ts">
/**
 * WAT-14 (Stage 6) — PUBLIC, MOBILE-FIRST learner experience for a COURSE at
 * /learn/c/:slug.
 *
 * A course is a container of published lessons sharing one link. Phases:
 *   - loading        → spinner.
 *   - not-available  → unknown / unpublished course slug.
 *   - landing        → title + description + lesson list (durations) + total time
 *                      + auth flow (per course auth_mode) + Start.
 *   - overview       → the lesson list with per-lesson completion ticks; tap a
 *                      lesson to launch the Stage-5 lesson player (/learn/:slug).
 *                      Sequential mode: locked lessons are visible but not
 *                      tappable until their prerequisites are complete.
 *   - completion     → all lessons complete.
 *
 * On returning from a lesson player (it navigates back here with
 * ?completed=<lessonId>), we mark that lesson complete (server for name/email,
 * localStorage for anonymous) and refresh completion + course-complete state.
 *
 * Persistence mirrors WAT-13: anonymous → localStorage (keyed by course slug);
 * name/email → server-side course learner. NO score/points shown — by design.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchCourseBySlug,
  startCourseLearner,
  saveCourseLessonProgress,
  type PublicCourse,
} from '@/api/courses-api'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

type Phase = 'loading' | 'not-available' | 'landing' | 'overview' | 'completion'
const phase = ref<Phase>('loading')
const notAvailableMessage = ref('This course is not available.')
const course = ref<PublicCourse | null>(null)
const completedLessonIds = ref<string[]>([])

const identifier = ref('')
const authError = ref('')
const starting = ref(false)
let learnerId: string | null = null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LS_PREFIX = 'aha-learn-course:'

const authMode = computed(() => course.value?.authMode ?? 'name')
const orderMode = computed(() => course.value?.orderMode ?? 'free')
const isServer = computed(() => authMode.value === 'name' || authMode.value === 'email')
const lessons = computed(() => course.value?.lessons ?? [])
const completedCount = computed(
  () => lessons.value.filter((l) => completedLessonIds.value.includes(l.lessonId)).length,
)
const allComplete = computed(
  () => lessons.value.length > 0 && completedCount.value === lessons.value.length,
)

// localStorage progress for anonymous learners (set of completed lesson ids).
function readLocalCompleted(): string[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX + slug)
    if (!raw) return []
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function writeLocalCompleted(ids: string[]) {
  try {
    localStorage.setItem(LS_PREFIX + slug, JSON.stringify(ids))
  } catch {
    /* storage disabled — in-memory only */
  }
}

/**
 * Sequential locking: a lesson is unlocked iff order mode is free OR every
 * earlier lesson (by order) is complete. Locked lessons are visible but not
 * tappable.
 */
function isUnlocked(index: number): boolean {
  if (orderMode.value !== 'sequential') return true
  for (let i = 0; i < index; i++) {
    if (!completedLessonIds.value.includes(lessons.value[i].lessonId)) return false
  }
  return true
}
function isComplete(lessonId: string): boolean {
  return completedLessonIds.value.includes(lessonId)
}

function validateAuth(): boolean {
  authError.value = ''
  if (authMode.value === 'anonymous') return true
  const val = identifier.value.trim()
  if (!val) {
    authError.value = authMode.value === 'email' ? 'Please enter your email.' : 'Please enter your name.'
    return false
  }
  if (authMode.value === 'email' && !EMAIL_RE.test(val)) {
    authError.value = 'Please enter a valid email address.'
    return false
  }
  return true
}

onMounted(async () => {
  const result = await fetchCourseBySlug(slug)
  if (!result.available) {
    notAvailableMessage.value = result.error
    phase.value = 'not-available'
    return
  }
  course.value = result.course
  completedLessonIds.value = result.completedLessonIds ?? []

  // Returning from a lesson player? It appends ?completed=<lessonId>&learner=<id>.
  const returnedLearner = typeof route.query.learner === 'string' ? route.query.learner : null
  const completedLessonId =
    typeof route.query.completed === 'string' ? route.query.completed : null

  if (isServer.value) {
    if (returnedLearner) learnerId = returnedLearner
  } else {
    completedLessonIds.value = readLocalCompleted()
  }

  if (completedLessonId) {
    await markComplete(completedLessonId)
    // Clean the query so a refresh doesn't re-mark.
    await router.replace({ name: 'learn-course', params: { slug }, query: {} })
    phase.value = allComplete.value ? 'completion' : 'overview'
    return
  }

  // If we already have progress (server learner via query, or local), skip auth.
  if ((isServer.value && learnerId) || (!isServer.value && completedLessonIds.value.length)) {
    phase.value = allComplete.value ? 'completion' : 'overview'
    return
  }
  phase.value = 'landing'
})

async function startCourse(): Promise<void> {
  if (!validateAuth()) return
  starting.value = true
  try {
    if (isServer.value) {
      const res = await startCourseLearner(slug, identifier.value.trim())
      learnerId = res.learnerId
      completedLessonIds.value = res.completedLessonIds ?? []
    } else {
      completedLessonIds.value = readLocalCompleted()
    }
    phase.value = allComplete.value ? 'completion' : 'overview'
  } catch {
    // Degrade gracefully — let them browse the overview anyway.
    phase.value = 'overview'
  } finally {
    starting.value = false
  }
}

/** Mark one member lesson complete (server or local) + refresh state. */
async function markComplete(lessonId: string): Promise<void> {
  if (!completedLessonIds.value.includes(lessonId)) {
    completedLessonIds.value = [...completedLessonIds.value, lessonId]
  }
  if (isServer.value && learnerId) {
    try {
      const res = await saveCourseLessonProgress(slug, learnerId, lessonId, true)
      completedLessonIds.value = res.completedLessonIds ?? completedLessonIds.value
    } catch {
      /* best-effort */
    }
  } else {
    writeLocalCompleted(completedLessonIds.value)
  }
}

/** Launch the Stage-5 lesson player for a member lesson, carrying course context. */
function openLesson(index: number): void {
  if (!isUnlocked(index)) return
  const lesson = lessons.value[index]
  router.push({
    name: 'learn-lesson',
    params: { slug: lesson.slug },
    query: {
      course: slug,
      ...(isServer.value && learnerId ? { learner: learnerId } : {}),
    },
  })
}
</script>

<template>
  <main class="learn">
    <!-- Loading -->
    <section v-if="phase === 'loading'" class="screen screen--center" aria-busy="true">
      <div class="spinner" role="status" aria-label="Loading course"></div>
    </section>

    <!-- Not available -->
    <section v-else-if="phase === 'not-available'" class="screen screen--center">
      <div class="card">
        <div class="emoji" aria-hidden="true">😕</div>
        <h1 class="title">Course not available</h1>
        <p class="muted">{{ notAvailableMessage }}</p>
      </div>
    </section>

    <!-- Landing + auth -->
    <section v-else-if="phase === 'landing' && course" class="screen landing">
      <div class="landing__body">
        <p class="eyebrow">Course</p>
        <h1 class="title title--lg">{{ course.title || 'Untitled course' }}</h1>
        <p v-if="course.description" class="lead">{{ course.description }}</p>
        <ul class="meta">
          <li>{{ lessons.length }} {{ lessons.length === 1 ? 'lesson' : 'lessons' }}</li>
          <li v-if="course.totalDurationMinutes">~{{ course.totalDurationMinutes }} min</li>
          <li>Self-paced</li>
        </ul>

        <ol class="lessonlist lessonlist--preview">
          <li v-for="(l, i) in lessons" :key="l.lessonId" class="lessonrow lessonrow--static">
            <span class="lessonrow__num">{{ i + 1 }}</span>
            <span class="lessonrow__title">{{ l.title }}</span>
            <span v-if="l.estimatedDurationMinutes" class="lessonrow__meta">
              {{ l.estimatedDurationMinutes }}m
            </span>
          </li>
        </ol>

        <form class="auth" @submit.prevent="startCourse">
          <label v-if="authMode === 'name'" class="field">
            <span class="field__label">What's your name?</span>
            <input
              v-model="identifier"
              class="input"
              type="text"
              autocomplete="name"
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
        <button class="cta" type="button" :disabled="starting" @click="startCourse">
          {{ starting ? 'Starting…' : 'Start course' }}
        </button>
      </div>
    </section>

    <!-- Overview (lesson list with completion + locking) -->
    <section v-else-if="phase === 'overview' && course" class="screen overview">
      <div class="overview__body">
        <p class="eyebrow">Course</p>
        <h1 class="title title--lg">{{ course.title }}</h1>
        <div class="progress">
          <div class="progress__bar" aria-hidden="true">
            <div
              class="progress__fill"
              :style="{ width: lessons.length ? (completedCount / lessons.length) * 100 + '%' : '0%' }"
            ></div>
          </div>
          <p class="progress__label">{{ completedCount }} of {{ lessons.length }} lessons complete</p>
        </div>

        <ol class="lessonlist">
          <li
            v-for="(l, i) in lessons"
            :key="l.lessonId"
            :class="[
              'lessonrow',
              isComplete(l.lessonId) ? 'lessonrow--done' : '',
              !isUnlocked(i) ? 'lessonrow--locked' : '',
            ]"
          >
            <button
              type="button"
              class="lessonrow__btn"
              :disabled="!isUnlocked(i)"
              :data-testid="'lesson-' + i"
              @click="openLesson(i)"
            >
              <span class="lessonrow__num">
                <span v-if="isComplete(l.lessonId)" aria-hidden="true">✓</span>
                <span v-else-if="!isUnlocked(i)" aria-hidden="true">🔒</span>
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span class="lessonrow__title">{{ l.title }}</span>
              <span v-if="l.estimatedDurationMinutes" class="lessonrow__meta">
                {{ l.estimatedDurationMinutes }}m
              </span>
              <span v-if="isComplete(l.lessonId)" class="lessonrow__status">Complete</span>
              <span v-else-if="!isUnlocked(i)" class="lessonrow__status">Locked</span>
              <span v-else class="lessonrow__status lessonrow__status--go">Start →</span>
            </button>
          </li>
        </ol>
      </div>
    </section>

    <!-- Completion -->
    <section v-else-if="phase === 'completion'" class="screen completion">
      <div class="completion__body">
        <div class="emoji emoji--lg" aria-hidden="true">🏆</div>
        <h1 class="title title--lg">Course complete!</h1>
        <p class="lead">You've finished every lesson in this course. Great work.</p>
      </div>
      <div class="actionbar">
        <button class="cta" type="button" @click="phase = 'overview'">Review lessons</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* MOBILE-FIRST (base = 375px). Shares the WAT-13 LearnLesson visual language. */
.learn {
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  color: #1a1a2e;
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
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f0f4ff;
  border-top-color: #6a1ebb;
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
  color: #3e3e5a;
  margin: 0 0 16px;
}
.muted {
  font-size: 16px;
  color: #3e3e5a;
  margin: 0;
}

.landing,
.overview {
  padding: 24px 20px 0;
}
.landing__body,
.overview__body {
  flex: 1;
  padding-bottom: 24px;
}
.meta {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0 0 20px;
}
.meta li {
  font-size: 14px;
  font-weight: 600;
  color: #3e3e5a;
  background: #f0f4ff;
  border-radius: 999px;
  padding: 6px 12px;
}

/* Progress bar (overview) */
.progress {
  margin: 4px 0 20px;
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

/* Lesson list */
.lessonlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lessonrow {
  border-radius: 14px;
}
.lessonrow__btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
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
}
.lessonrow__btn:active {
  background: #f0f4ff;
}
.lessonrow__btn:focus-visible {
  outline: none;
  border-color: #6a1ebb;
  box-shadow: 0 0 0 3px rgba(106, 30, 187, 0.18);
}
.lessonrow__btn:disabled {
  cursor: not-allowed;
}
.lessonrow--locked .lessonrow__btn {
  opacity: 0.6;
  background: #f7f8fc;
}
.lessonrow--done .lessonrow__btn {
  border-color: #0f9b78;
  background: #e6fbf4;
}
.lessonrow__num {
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #f0f4ff;
  color: #6a1ebb;
  font-weight: 800;
  font-size: 14px;
}
.lessonrow--done .lessonrow__num {
  background: #0f9b78;
  color: #ffffff;
}
.lessonrow__title {
  flex: 1;
  min-width: 0;
}
.lessonrow__meta {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 600;
  color: #3e3e5a;
}
.lessonrow__status {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 700;
  color: #3e3e5a;
}
.lessonrow__status--go {
  color: #6a1ebb;
}
.lessonrow--done .lessonrow__status {
  color: #0a6e55;
}

/* Static (landing preview) rows — non-interactive */
.lessonlist--preview {
  margin-bottom: 8px;
}
.lessonrow--static {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  border: 2px solid #d9def0;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 600;
}

/* Action bar */
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
  background: #6a1ebb;
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

/* Auth */
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
  font-size: 16px;
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
  color: #c20050;
  font-size: 15px;
  font-weight: 600;
  margin: 10px 0 0;
}

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

@media (min-width: 600px) {
  .landing__body,
  .overview__body,
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
  .title--lg {
    font-size: 32px;
  }
}
</style>
