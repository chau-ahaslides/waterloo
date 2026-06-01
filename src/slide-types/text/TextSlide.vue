<script setup lang="ts">
// TextSlide.vue — renders ONE authored Text content slide: an optional heading
// + a plain-text body (line breaks preserved) and a Continue button. Info-only
// (captures no response); emits `continue` so the generic player advances.

import { computed } from 'vue'
import { ArrowRightOutlined } from '@ant-design/icons-vue'
import type { TextLessonSlide } from './module'

const props = defineProps<{
  slide: TextLessonSlide
  /** Unused for info-only slides; present so the player can wire all types alike. */
  showingFeedback?: boolean
  /** Always null for info-only slides. */
  response?: null
}>()

const emit = defineEmits<{
  (e: 'continue'): void
}>()

const hasContent = computed(
  () => !!(props.slide.heading?.trim() || props.slide.body?.trim()),
)
</script>

<template>
  <div class="mx-auto w-full max-w-2xl">
    <article class="rounded-aha border-2 border-aha-indigo/10 bg-white p-8 shadow-aha-sm">
      <span
        class="mb-4 inline-flex items-center rounded-full bg-aha-lavender/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-aha-purple"
      >
        Text
      </span>
      <h2
        v-if="slide.heading"
        class="mb-3 text-2xl font-extrabold leading-snug text-aha-space sm:text-3xl"
      >
        {{ slide.heading }}
      </h2>
      <p
        v-if="slide.body"
        class="whitespace-pre-line text-base leading-relaxed text-aha-space"
      >
        {{ slide.body }}
      </p>
      <p v-if="!hasContent" class="italic text-aha-indigo">
        (empty text slide)
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
