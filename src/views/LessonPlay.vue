<script setup lang="ts">
// LessonPlay.vue — GENERIC audience/learner view for a single lesson.
//
// It is slide-type-agnostic: for each lesson slide it renders the registered
// slide-type's component (via the registry) and wires the contract events:
//   - response types  → component emits `answered` → tally score, show brief
//                        feedback, then auto-advance after 800ms.
//   - info-only types  → component emits `continue` → advance immediately.
// It keeps the progress bar, score (counts ONLY response-bearing slides) and
// completion screen. Adding a new slide type needs NO change here.

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftOutlined, CloseCircleFilled, TrophyOutlined } from '@ant-design/icons-vue'
import { loadLessons, type Lesson, type LessonSlide } from '@/lessons/lessons'
import {
  getSlideComponent,
  scoreForSlide,
  typeHasResponse,
} from '@/slide-types/registry'

// ── Route params ──────────────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

// ── Load lesson ───────────────────────────────────────────────────────────────
const lesson = loadLessons().find((l: Lesson) => l.id === lessonId) ?? null

// ── Playback state ────────────────────────────────────────────────────────────
/** Index of the currently displayed slide. */
const currentIndex = ref(0)
/** The captured response for the current slide (module-defined; null = pending). */
const currentResponse = ref<unknown>(null)
/** Whether the feedback phase is active (auto-advance pending) for a response slide. */
const showingFeedback = ref(false)
/** Whether we've reached the completion screen. */
const completed = ref(false)
/** Cumulative score (response-bearing slides only). */
const score = ref(0)

const ADVANCE_DELAY_MS = 800

const currentSlide = computed<LessonSlide | null>(() => {
  if (!lesson) return null
  return lesson.slides[currentIndex.value] ?? null
})

/** The registered component that renders the current slide. */
const currentComponent = computed(() =>
  currentSlide.value ? getSlideComponent(currentSlide.value.type) : undefined,
)

const totalSlides = computed(() => lesson?.slides.length ?? 0)
/** 1-based display number for the current slide. */
const slideNumber = computed(() => currentIndex.value + 1)

/** Number of response-bearing (scored) slides — the score denominator. */
const totalScored = computed(
  () => lesson?.slides.filter((s) => typeHasResponse(s.type)).length ?? 0,
)
/** Scored slides answered so far (before the current index). */
const scoredAnswered = computed(
  () =>
    lesson?.slides
      .slice(0, currentIndex.value)
      .filter((s) => typeHasResponse(s.type)).length ?? 0,
)

/** Progress percentage (0-100) based on slides advanced past so far. */
const progressPercent = computed(() =>
  totalSlides.value ? Math.round((currentIndex.value / totalSlides.value) * 100) : 0,
)

/**
 * Response slide answered: tally score via the module, show feedback, then
 * auto-advance. `response` is whatever the slide-type component emitted.
 */
function onAnswered(response: unknown) {
  if (showingFeedback.value || currentResponse.value !== null) return
  const slide = currentSlide.value
  if (!slide) return

  currentResponse.value = response
  showingFeedback.value = true
  score.value += scoreForSlide(slide, response)

  setTimeout(advance, ADVANCE_DELAY_MS)
}

/** Info-only slide done: advance immediately (no score, no feedback delay). */
function onContinue() {
  advance()
}

function advance() {
  const nextIndex = currentIndex.value + 1
  if (nextIndex >= totalSlides.value) {
    completed.value = true
  } else {
    currentIndex.value = nextIndex
    currentResponse.value = null
    showingFeedback.value = false
  }
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}

function restart() {
  currentIndex.value = 0
  currentResponse.value = null
  showingFeedback.value = false
  completed.value = false
  score.value = 0
}
</script>

<template>
  <!-- ── Unknown lesson ─────────────────────────────────────────────────────── -->
  <main
    v-if="!lesson"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
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
    v-else-if="totalSlides === 0"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
      <TrophyOutlined />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Nothing to preview</h1>
    <p class="text-aha-indigo">
      This lesson has no slides yet. Convert a presentation with supported slides first.
    </p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Completion screen ──────────────────────────────────────────────────── -->
  <main
    v-else-if="completed"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-24 w-24 items-center justify-center rounded-full bg-aha-teal/20 text-5xl text-aha-teal">
      <TrophyOutlined />
    </div>
    <h1 class="text-3xl font-extrabold text-aha-space">
      {{ totalScored > 0 && score === totalScored ? '🎉 Perfect!' : 'Lesson complete!' }}
    </h1>
    <p v-if="totalScored > 0" class="text-xl text-aha-indigo">
      You got
      <span class="font-extrabold text-aha-purple">{{ score }}/{{ totalScored }}</span>
      correct
    </p>
    <p v-else class="text-xl text-aha-indigo">You've reached the end.</p>
    <div class="flex items-center gap-3">
      <a-button @click="restart">Try again</a-button>
      <a-button type="primary" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
        Back to My Lessons
      </a-button>
    </div>
  </main>

  <!-- ── Active lesson ──────────────────────────────────────────────────────── -->
  <main v-else class="flex min-h-[100dvh] w-full flex-col bg-aha-blush">
    <!-- Top bar -->
    <header class="flex w-full items-center gap-4 border-b border-aha-indigo/10 bg-white px-6 py-4 shadow-aha-sm">
      <a-button type="text" size="small" class="shrink-0" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-aha-space" :title="lesson.title">
          {{ lesson.title }}
        </p>
        <p class="text-xs text-aha-indigo">{{ slideNumber }} / {{ totalSlides }}</p>
      </div>
      <!-- Score badge (only when the lesson has scored slides) -->
      <span
        v-if="totalScored > 0"
        class="shrink-0 rounded-full bg-aha-purple px-3 py-1 text-xs font-bold text-white"
      >
        {{ score }} / {{ scoredAnswered }} correct
      </span>
    </header>

    <!-- Progress bar -->
    <a-progress
      :percent="progressPercent"
      :show-info="false"
      stroke-color="#6A1EBB"
      trail-color="#D3B4FF"
      class="block w-full !m-0 rounded-none"
      :stroke-width="6"
    />

    <!-- Slide body: render the registered slide-type component for this slide. -->
    <div class="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <component
        :is="currentComponent"
        v-if="currentComponent && currentSlide"
        :key="currentSlide.id"
        :slide="currentSlide"
        :showing-feedback="showingFeedback"
        :response="currentResponse"
        @answered="onAnswered"
        @continue="onContinue"
      />
      <!-- Fallback: an unregistered slide type (defensive — should not occur). -->
      <div v-else class="text-center text-aha-indigo">
        <p class="mb-6">This slide type can't be previewed yet.</p>
        <a-button type="primary" @click="advance">Continue</a-button>
      </div>
    </div>
  </main>
</template>
