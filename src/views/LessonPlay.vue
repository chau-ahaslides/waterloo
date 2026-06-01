<script setup lang="ts">
// LessonPlay.vue — audience/learner view for a single lesson.
//
// Shows pick-answer questions one at a time. When the learner selects an
// option the UI flashes correct/incorrect feedback for ~800 ms, then
// auto-advances to the next question. After the last question a completion
// screen is shown with the final score.

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  TrophyOutlined,
} from '@ant-design/icons-vue'
import { loadLessons, type LessonSlide, type LessonOption } from '@/lessons/lessons'

// ── Route params ──────────────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

// ── Load lesson ───────────────────────────────────────────────────────────────
const lesson = loadLessons().find((l) => l.id === lessonId) ?? null

// ── Playback state ────────────────────────────────────────────────────────────
/** Index of the currently displayed question. */
const currentIndex = ref(0)
/** Id of the option the learner selected for the current question (null = not yet answered). */
const selectedOptionId = ref<number | null>(null)
/** Whether the feedback phase is active (auto-advance pending). */
const showingFeedback = ref(false)
/** Whether all questions have been answered and we're on the completion screen. */
const completed = ref(false)
/** Cumulative score. */
const score = ref(0)

const ADVANCE_DELAY_MS = 800

const currentSlide = computed<LessonSlide | null>(() => {
  if (!lesson) return null
  return lesson.slides[currentIndex.value] ?? null
})

const totalQuestions = computed(() => lesson?.slides.length ?? 0)
/** 1-based display number for the current question. */
const questionNumber = computed(() => currentIndex.value + 1)

/** Progress percentage (0-100) based on questions answered so far. */
const progressPercent = computed(() =>
  totalQuestions.value ? Math.round((currentIndex.value / totalQuestions.value) * 100) : 0,
)

function isCorrectOption(opt: LessonOption): boolean {
  return opt.isCorrect
}

function isSelectedOption(opt: LessonOption): boolean {
  return selectedOptionId.value === opt.id
}

/**
 * Called when the learner taps an answer option.
 * - Locks the selection, tallies the score, shows brief feedback, then advances.
 */
function selectOption(opt: LessonOption) {
  if (showingFeedback.value || selectedOptionId.value !== null) return

  selectedOptionId.value = opt.id
  showingFeedback.value = true

  if (opt.isCorrect) {
    score.value += 1
  }

  setTimeout(() => {
    advance()
  }, ADVANCE_DELAY_MS)
}

function advance() {
  const nextIndex = currentIndex.value + 1
  if (nextIndex >= totalQuestions.value) {
    completed.value = true
  } else {
    currentIndex.value = nextIndex
    selectedOptionId.value = null
    showingFeedback.value = false
  }
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}

function restart() {
  currentIndex.value = 0
  selectedOptionId.value = null
  showingFeedback.value = false
  completed.value = false
  score.value = 0
}

/** CSS classes for an option button, reflecting feedback state. */
function optionClass(opt: LessonOption): string {
  const base =
    'w-full rounded-aha border-2 px-5 py-4 text-left text-base font-semibold transition-all duration-200 focus:outline-none'

  if (!showingFeedback.value) {
    // Pre-answer: default neutral state.
    return `${base} border-aha-indigo/20 bg-white text-aha-space hover:border-aha-purple hover:bg-aha-lavender/20 hover:shadow-aha-sm active:scale-[0.98]`
  }

  const chosen = isSelectedOption(opt)
  const correct = isCorrectOption(opt)

  if (correct) {
    // Always highlight the correct answer in teal.
    return `${base} border-aha-teal bg-aha-teal/10 text-aha-space`
  }
  if (chosen && !correct) {
    // The wrong choice: highlight in carmine.
    return `${base} border-aha-carmine bg-aha-carmine/10 text-aha-carmine`
  }
  // Unchosen, wrong: dim out.
  return `${base} border-aha-indigo/10 bg-gray-50 text-aha-indigo opacity-60`
}
</script>

<template>
  <!-- ── Unknown lesson ─────────────────────────────────────────────────────── -->
  <main
    v-if="!lesson"
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
      <CloseCircleFilled />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Lesson not found</h1>
    <p class="text-aha-indigo">This lesson may have been deleted or the link is invalid.</p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Empty lesson ───────────────────────────────────────────────────────── -->
  <main
    v-else-if="totalQuestions === 0"
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
      <TrophyOutlined />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Nothing to preview</h1>
    <p class="text-aha-indigo">
      This lesson has no quiz questions yet. Convert a presentation with pick-answer slides first.
    </p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Completion screen ──────────────────────────────────────────────────── -->
  <main
    v-else-if="completed"
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-24 w-24 items-center justify-center rounded-full bg-aha-teal/20 text-5xl text-aha-teal">
      <TrophyOutlined />
    </div>
    <h1 class="text-3xl font-extrabold text-aha-space">
      {{ score === totalQuestions ? '🎉 Perfect!' : 'Lesson complete!' }}
    </h1>
    <p class="text-xl text-aha-indigo">
      You got
      <span class="font-extrabold text-aha-purple">{{ score }}/{{ totalQuestions }}</span>
      correct
    </p>
    <div class="flex gap-3">
      <a-button @click="restart">Try again</a-button>
      <a-button type="primary" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
        Back to My Lessons
      </a-button>
    </div>
  </main>

  <!-- ── Active quiz ────────────────────────────────────────────────────────── -->
  <main
    v-else
    class="flex min-h-screen flex-col bg-aha-blush"
  >
    <!-- Top bar -->
    <header class="flex items-center gap-4 border-b border-aha-indigo/10 bg-white px-6 py-4 shadow-aha-sm">
      <a-button type="text" size="small" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
      <div class="flex-1 min-w-0">
        <p class="truncate text-sm font-semibold text-aha-space" :title="lesson.title">
          {{ lesson.title }}
        </p>
        <p class="text-xs text-aha-indigo">
          Q {{ questionNumber }} / {{ totalQuestions }}
        </p>
      </div>
      <!-- Score badge -->
      <span class="rounded-full bg-aha-purple px-3 py-1 text-xs font-bold text-white">
        {{ score }} / {{ questionNumber - 1 }} correct
      </span>
    </header>

    <!-- Progress bar -->
    <a-progress
      :percent="progressPercent"
      :show-info="false"
      stroke-color="#6A1EBB"
      trail-color="#D3B4FF"
      class="m-0 rounded-none"
      :stroke-width="6"
    />

    <!-- Question + options -->
    <div class="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <!-- Feedback banner -->
      <transition name="fade">
        <div
          v-if="showingFeedback && selectedOptionId !== null"
          class="mb-6 flex items-center gap-2 rounded-aha px-5 py-3 text-sm font-semibold"
          :class="
            currentSlide?.options.find((o) => o.id === selectedOptionId)?.isCorrect
              ? 'bg-aha-teal/15 text-aha-space'
              : 'bg-aha-carmine/10 text-aha-carmine'
          "
        >
          <CheckCircleFilled
            v-if="currentSlide?.options.find((o) => o.id === selectedOptionId)?.isCorrect"
            class="text-aha-teal"
          />
          <CloseCircleFilled v-else class="text-aha-carmine" />
          <span>
            {{
              currentSlide?.options.find((o) => o.id === selectedOptionId)?.isCorrect
                ? 'Correct!'
                : 'Not quite — see the correct answer highlighted'
            }}
          </span>
        </div>
      </transition>

      <!-- Question text -->
      <h2 class="mb-8 text-xl font-extrabold leading-snug text-aha-space sm:text-2xl">
        {{ currentSlide?.question }}
      </h2>

      <!-- Answer options -->
      <div class="flex flex-col gap-3">
        <button
          v-for="opt in currentSlide?.options"
          :key="opt.id"
          :class="optionClass(opt)"
          :disabled="showingFeedback"
          @click="selectOption(opt)"
        >
          <span class="flex items-center gap-3">
            <!-- Icon shown after answer -->
            <CheckCircleFilled
              v-if="showingFeedback && opt.isCorrect"
              class="shrink-0 text-aha-teal"
            />
            <CloseCircleFilled
              v-else-if="showingFeedback && isSelectedOption(opt) && !opt.isCorrect"
              class="shrink-0 text-aha-carmine"
            />
            <span
              v-else
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-aha-indigo/30 text-xs font-bold text-aha-indigo"
            >
              {{ String.fromCharCode(65 + (currentSlide?.options.indexOf(opt) ?? 0)) }}
            </span>
            {{ opt.text || '(no text)' }}
          </span>
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
