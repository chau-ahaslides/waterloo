<script setup lang="ts">
// TextSlideEditor.vue — the authoring form for a Text slide. Edits the heading
// + body and emits `update:slide` with the new slide whenever a field changes.

import type { TextLessonSlide } from './module'

const props = defineProps<{ slide: TextLessonSlide }>()
const emit = defineEmits<{
  (e: 'update:slide', slide: TextLessonSlide): void
}>()

function patch(part: Partial<TextLessonSlide>) {
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
      <label class="mb-1 block text-sm font-semibold text-aha-space">Body text</label>
      <a-textarea
        :value="slide.body"
        placeholder="Type the lesson text here. Line breaks are preserved."
        :auto-size="{ minRows: 6, maxRows: 18 }"
        class="rounded-aha"
        @update:value="(v: string) => patch({ body: v })"
      />
      <p class="mt-1 text-xs text-aha-indigo">
        Plain text — line breaks are kept; no HTML.
      </p>
    </div>
  </div>
</template>
