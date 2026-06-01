<script setup lang="ts">
// PickAnswerSlide.vue — renders ONE pick-answer (multiple-choice) lesson slide
// in the audience/preview view AND handles its own response reception.
//
// This component owns the option buttons, the correct/wrong feedback banner and
// per-option highlighting. It emits `answered` with the selected option id when
// the learner taps an option. The generic player (LessonPlay.vue) is what
// tallies the score and schedules auto-advance — this component just renders
// state it is given (`showingFeedback`, `response`) and reports the tap.

import { computed } from 'vue'
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons-vue'
import type { PickAnswerLessonSlide, PickAnswerOption } from './module'

const props = defineProps<{
  slide: PickAnswerLessonSlide
  /** True once an option has been chosen and feedback is showing. */
  showingFeedback: boolean
  /** The selected option id (the captured response), or null before answering. */
  response: number | null
}>()

const emit = defineEmits<{
  /** Fired when the learner taps an option. Payload = selected option id. */
  (e: 'answered', optionId: number): void
}>()

const selectedOption = computed<PickAnswerOption | null>(
  () => props.slide.options.find((o) => o.id === props.response) ?? null,
)

function isSelectedOption(opt: PickAnswerOption): boolean {
  return props.response === opt.id
}

function selectOption(opt: PickAnswerOption) {
  // Double-tap / already-answered guard mirrors the previous inline behaviour;
  // the player also guards, but keep it here so the component is correct alone.
  if (props.showingFeedback || props.response !== null) return
  emit('answered', opt.id)
}

/** CSS classes for an option button, reflecting feedback state. */
function optionClass(opt: PickAnswerOption): string {
  const base =
    'w-full rounded-aha border-2 px-5 py-4 text-left text-base font-semibold transition-all duration-200 focus:outline-none'

  if (!props.showingFeedback) {
    return `${base} border-aha-indigo/20 bg-white text-aha-space hover:border-aha-purple hover:bg-aha-lavender/20 hover:shadow-aha-sm active:scale-[0.98]`
  }

  const chosen = isSelectedOption(opt)
  if (opt.isCorrect) {
    return `${base} border-aha-teal bg-aha-teal/10 text-aha-space`
  }
  if (chosen && !opt.isCorrect) {
    return `${base} border-aha-carmine bg-aha-carmine/10 text-aha-carmine`
  }
  return `${base} border-aha-indigo/10 bg-gray-50 text-aha-indigo opacity-60`
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl">
    <!-- Feedback banner -->
    <transition name="fade">
      <div
        v-if="showingFeedback && selectedOption"
        class="mb-6 flex items-center gap-2 rounded-aha px-5 py-3 text-sm font-semibold"
        :class="selectedOption.isCorrect ? 'bg-aha-teal/15 text-aha-space' : 'bg-aha-carmine/10 text-aha-carmine'"
      >
        <CheckCircleFilled v-if="selectedOption.isCorrect" class="text-aha-teal" />
        <CloseCircleFilled v-else class="text-aha-carmine" />
        <span>
          {{ selectedOption.isCorrect ? 'Correct!' : 'Not quite — see the correct answer highlighted' }}
        </span>
      </div>
    </transition>

    <!-- Question text -->
    <h2 class="mb-8 text-xl font-extrabold leading-snug text-aha-space sm:text-2xl">
      {{ slide.question }}
    </h2>

    <!-- Answer options -->
    <div class="flex flex-col gap-3">
      <button
        v-for="(opt, i) in slide.options"
        :key="opt.id"
        :class="optionClass(opt)"
        :disabled="showingFeedback"
        @click="selectOption(opt)"
      >
        <span class="flex items-center gap-3">
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
            {{ String.fromCharCode(65 + i) }}
          </span>
          {{ opt.text || '(no text)' }}
        </span>
      </button>
    </div>
  </div>
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
