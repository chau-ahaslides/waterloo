<script setup lang="ts">
// HtmlSlideEditor.vue — authoring form for an HTML slide. The trainer pastes
// raw HTML; a live sanitized preview shows exactly what learners will see (the
// same sanitizer the player uses), so unsafe markup is visibly stripped.

import { computed } from 'vue'
import type { HtmlLessonSlide } from './module'
import { sanitizeHtml } from './sanitize'

const props = defineProps<{ slide: HtmlLessonSlide }>()
const emit = defineEmits<{
  (e: 'update:slide', slide: HtmlLessonSlide): void
}>()

const safePreview = computed(() => sanitizeHtml(props.slide.html ?? ''))

function patch(part: Partial<HtmlLessonSlide>) {
  emit('update:slide', { ...props.slide, ...part })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Heading</label>
      <a-input
        :value="slide.heading"
        placeholder="Optional heading"
        :maxlength="200"
        class="rounded-aha"
        @update:value="(v: string) => patch({ heading: v })"
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">HTML</label>
      <a-textarea
        :value="slide.html"
        placeholder="<p>Paste your HTML here…</p>"
        :auto-size="{ minRows: 6, maxRows: 16 }"
        class="rounded-aha font-mono text-sm"
        @update:value="(v: string) => patch({ html: v })"
      />
      <p class="mt-1 text-xs text-aha-indigo">
        Scripts, iframes and event handlers are removed for safety. Allowed:
        headings, text, lists, links, images, tables.
      </p>
    </div>
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Sanitized preview</label>
      <div
        class="rounded-aha border-2 border-dashed border-aha-indigo/20 bg-aha-blush/40 p-4"
      >
        <!-- eslint-disable-next-line vue/no-v-html — sanitized above -->
        <div v-if="safePreview" class="aha-html-content text-aha-space" v-html="safePreview" />
        <p v-else class="m-0 italic text-aha-indigo">Nothing to preview yet.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aha-html-content :deep(ul),
.aha-html-content :deep(ol) {
  margin: 0 0 0.5em 1.25em;
  list-style: revert;
}
.aha-html-content :deep(a) {
  color: #6a1ebb;
  text-decoration: underline;
}
.aha-html-content :deep(img) {
  max-width: 100%;
}
</style>
