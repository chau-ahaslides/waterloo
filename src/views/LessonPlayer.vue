<script setup lang="ts">
// LessonPlayer.vue — the SHARED, slide-type-agnostic playback experience for a
// single lesson. Both the preview run (LessonPlay.vue, local, no submit) and
// the real audience run (TakeLesson.vue, submits to D1) embed this component so
// there is ONE player, not two divergent copies.
//
// For each lesson slide it renders the registered slide-type's component (via
// the registry) and wires the contract events:
//   - response types  → component emits `answered` → tally score, build a
//                        generic response snapshot, show brief feedback, then
//                        auto-advance after 800ms.
//   - info-only types  → component emits `continue` → advance immediately
//                        (no score, no snapshot).
// It keeps the progress bar + running score. On the final slide it emits
// `complete` with { score, total, responses } — the COLLECTED per-slide
// snapshots (response-bearing slides only) + score/total. The parent owns the
// completion screen (preview shows "try again"; take submits + links to report).
//
// Adding a new slide type needs NO change here: snapshots come from the
// registry's generic `snapshotForSlide`, never a hardcoded type.

import { computed, ref } from 'vue'
import { ArrowLeftOutlined } from '@ant-design/icons-vue'
import type { Lesson, LessonSlide } from '@/lessons/lessons'
import {
  getSlideComponent,
  scoreForSlide,
  snapshotForSlide,
  typeHasResponse,
} from '@/slide-types/registry'
import type { AttemptResponse } from '@/api/attempts'

const props = defineProps<{
  lesson: Lesson
  /** Optional title shown in the header (defaults to the lesson title). */
  headerTitle?: string
}>()

const emit = defineEmits<{
  /** Fired when the last slide is done. Carries the collected run results. */
  (
    e: 'complete',
    payload: { score: number; total: number; responses: AttemptResponse[] },
  ): void
  /** Fired when the user taps the back button in the header. */
  (e: 'back'): void
}>()

// ── Playback state ────────────────────────────────────────────────────────────
const currentIndex = ref(0)
const currentResponse = ref<unknown>(null)
const showingFeedback = ref(false)
const score = ref(0)
/** Collected per-slide snapshots (response-bearing slides only). */
const responses = ref<AttemptResponse[]>([])

const ADVANCE_DELAY_MS = 800

const currentSlide = computed<LessonSlide | null>(
  () => props.lesson.slides[currentIndex.value] ?? null,
)
const currentComponent = computed(() =>
  currentSlide.value ? getSlideComponent(currentSlide.value.type) : undefined,
)

const totalSlides = computed(() => props.lesson.slides.length)
const slideNumber = computed(() => currentIndex.value + 1)

/** Number of response-bearing (scored) slides — the score denominator. */
const totalScored = computed(
  () => props.lesson.slides.filter((s) => typeHasResponse(s.type)).length,
)
/** Scored slides answered so far (before the current index). */
const scoredAnswered = computed(
  () =>
    props.lesson.slides
      .slice(0, currentIndex.value)
      .filter((s) => typeHasResponse(s.type)).length,
)

const progressPercent = computed(() =>
  totalSlides.value
    ? Math.round((currentIndex.value / totalSlides.value) * 100)
    : 0,
)

const title = computed(() => props.headerTitle ?? props.lesson.title)

/**
 * Response slide answered: tally score, capture a generic snapshot, show
 * feedback, then auto-advance. `response` is whatever the component emitted.
 */
function onAnswered(response: unknown) {
  if (showingFeedback.value || currentResponse.value !== null) return
  const slide = currentSlide.value
  if (!slide) return

  currentResponse.value = response
  showingFeedback.value = true
  score.value += scoreForSlide(slide, response)

  // Build a self-contained snapshot so the report renders from D1 alone.
  const snap = snapshotForSlide(slide, response)
  responses.value.push({
    slideId: slide.id,
    type: slide.type,
    question: snap.question,
    response: snap.response,
    correct: snap.correct,
  })

  setTimeout(advance, ADVANCE_DELAY_MS)
}

/** Info-only slide done: advance immediately (no score, no snapshot). */
function onContinue() {
  advance()
}

function advance() {
  const nextIndex = currentIndex.value + 1
  if (nextIndex >= totalSlides.value) {
    emit('complete', {
      score: score.value,
      total: totalScored.value,
      responses: responses.value,
    })
  } else {
    currentIndex.value = nextIndex
    currentResponse.value = null
    showingFeedback.value = false
  }
}

/** Reset to the first slide (used by a parent "try again" action). */
function restart() {
  currentIndex.value = 0
  currentResponse.value = null
  showingFeedback.value = false
  score.value = 0
  responses.value = []
}

defineExpose({ restart })
</script>

<template>
  <main class="flex min-h-[100dvh] w-full flex-col bg-aha-blush">
    <!-- Top bar -->
    <header
      class="flex w-full items-center gap-4 border-b border-aha-indigo/10 bg-white px-6 py-4 shadow-aha-sm"
    >
      <a-button type="text" size="small" class="shrink-0" @click="emit('back')">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-aha-space" :title="title">
          {{ title }}
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
