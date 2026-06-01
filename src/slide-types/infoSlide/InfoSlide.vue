<script setup lang="ts">
// InfoSlide.vue — renders ONE info-only lesson slide: a titled content card
// with an optional subheading / body / image and a Continue button. It captures
// NO response (the second slide type, proving the architecture supports
// info-only types — point #2 of the directive). It emits `continue` when the
// learner taps the button so the generic player advances.

import { ArrowRightOutlined } from '@ant-design/icons-vue'
import type { InfoLessonSlide } from './module'

defineProps<{
  slide: InfoLessonSlide
  /** Unused for info-only slides; present so the player can wire all types alike. */
  showingFeedback?: boolean
  /** Always null for info-only slides. */
  response?: null
}>()

const emit = defineEmits<{
  /** Fired when the learner taps Continue. */
  (e: 'continue'): void
}>()
</script>

<template>
  <div class="mx-auto w-full max-w-2xl">
    <article class="rounded-aha border-2 border-aha-indigo/10 bg-white p-8 shadow-aha-sm">
      <span
        class="mb-4 inline-flex items-center rounded-full bg-aha-lavender/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-aha-purple"
      >
        Info
      </span>
      <h2 class="mb-3 text-2xl font-extrabold leading-snug text-aha-space sm:text-3xl">
        {{ slide.title }}
      </h2>
      <p v-if="slide.subheading" class="mb-4 text-lg font-semibold text-aha-indigo">
        {{ slide.subheading }}
      </p>
      <img
        v-if="slide.image"
        :src="slide.image"
        :alt="slide.title"
        class="mb-4 max-h-72 w-full rounded-aha object-contain"
      />
      <p v-if="slide.body" class="whitespace-pre-line text-base leading-relaxed text-aha-space">
        {{ slide.body }}
      </p>
    </article>

    <div class="mt-8 flex justify-center">
      <a-button type="primary" size="large" @click="emit('continue')">
        Continue
        <template #icon><ArrowRightOutlined /></template>
      </a-button>
    </div>
  </div>
</template>
