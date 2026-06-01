<script setup lang="ts">
// InfoSlideEditor.vue — authoring form for a converted info slide. Info slides
// come from the converter (a presenter `freestyle` slide), not the palette, but
// they are still editable here: title, subheading, body, image URL. Emits
// `update:slide` on change.

import type { InfoLessonSlide } from './module'

const props = defineProps<{ slide: InfoLessonSlide }>()
const emit = defineEmits<{
  (e: 'update:slide', slide: InfoLessonSlide): void
}>()

function patch(part: Partial<InfoLessonSlide>) {
  emit('update:slide', { ...props.slide, ...part })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Title</label>
      <a-input
        :value="slide.title"
        placeholder="Slide title"
        :maxlength="200"
        class="rounded-aha"
        @update:value="(v: string) => patch({ title: v })"
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Subheading</label>
      <a-input
        :value="slide.subheading"
        placeholder="Optional subheading"
        :maxlength="200"
        class="rounded-aha"
        @update:value="(v: string) => patch({ subheading: v })"
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Body</label>
      <a-textarea
        :value="slide.body"
        placeholder="Body text"
        :auto-size="{ minRows: 4, maxRows: 12 }"
        class="rounded-aha"
        @update:value="(v: string) => patch({ body: v })"
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Image URL</label>
      <a-input
        :value="slide.image ?? ''"
        placeholder="https://…"
        class="rounded-aha"
        @update:value="(v: string) => patch({ image: v || null })"
      />
    </div>
  </div>
</template>
