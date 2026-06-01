<script setup lang="ts">
// HtmlSlide.vue — renders ONE authored HTML content slide. The stored raw HTML
// is SANITIZED to a safe subset (sanitize.ts) before being injected with
// v-html, so untrusted markup cannot run scripts or inline event handlers.
// Info-only; emits `continue` so the generic player advances.

import { computed } from 'vue'
import { ArrowRightOutlined } from '@ant-design/icons-vue'
import type { HtmlLessonSlide } from './module'
import { sanitizeHtml } from './sanitize'

const props = defineProps<{
  slide: HtmlLessonSlide
  showingFeedback?: boolean
  response?: null
}>()

const emit = defineEmits<{
  (e: 'continue'): void
}>()

const safeHtml = computed(() => sanitizeHtml(props.slide.html ?? ''))
</script>

<template>
  <div class="mx-auto w-full max-w-2xl">
    <article class="rounded-aha border-2 border-aha-indigo/10 bg-white p-8 shadow-aha-sm">
      <span
        class="mb-4 inline-flex items-center rounded-full bg-aha-lavender/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-aha-purple"
      >
        HTML
      </span>
      <h2
        v-if="slide.heading"
        class="mb-3 text-2xl font-extrabold leading-snug text-aha-space sm:text-3xl"
      >
        {{ slide.heading }}
      </h2>
      <!-- eslint-disable-next-line vue/no-v-html — sanitized above -->
      <div
        v-if="safeHtml"
        class="aha-html-content text-base leading-relaxed text-aha-space"
        v-html="safeHtml"
      />
      <p v-else class="italic text-aha-indigo">(empty HTML slide)</p>
    </article>

    <div class="mt-8 flex justify-center">
      <a-button type="primary" size="large" @click="emit('continue')">
        Continue
        <template #icon><ArrowRightOutlined /></template>
      </a-button>
    </div>
  </div>
</template>

<style scoped>
.aha-html-content :deep(h1),
.aha-html-content :deep(h2),
.aha-html-content :deep(h3) {
  font-weight: 800;
  margin: 0.5em 0 0.3em;
  line-height: 1.2;
}
.aha-html-content :deep(p) {
  margin: 0 0 0.75em;
}
.aha-html-content :deep(ul),
.aha-html-content :deep(ol) {
  margin: 0 0 0.75em 1.25em;
  list-style: revert;
}
.aha-html-content :deep(a) {
  color: #6a1ebb;
  text-decoration: underline;
}
.aha-html-content :deep(img) {
  max-width: 100%;
  border-radius: 12px;
}
.aha-html-content :deep(table) {
  border-collapse: collapse;
}
.aha-html-content :deep(td),
.aha-html-content :deep(th) {
  border: 1px solid rgba(58, 47, 102, 0.2);
  padding: 6px 10px;
}
</style>
