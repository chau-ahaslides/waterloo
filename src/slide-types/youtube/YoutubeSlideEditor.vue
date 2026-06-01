<script setup lang="ts">
// YoutubeSlideEditor.vue — authoring form for a YouTube slide. The trainer
// pastes a URL or id; a live thumbnail/embed preview + a recognised-id badge
// confirm the video resolved (or warn that it didn't).

import { computed } from 'vue'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons-vue'
import { parseYouTubeId, youtubeEmbedUrl, type YoutubeLessonSlide } from './module'

const props = defineProps<{ slide: YoutubeLessonSlide }>()
const emit = defineEmits<{
  (e: 'update:slide', slide: YoutubeLessonSlide): void
}>()

const videoId = computed(() => parseYouTubeId(props.slide.url ?? ''))
const embedUrl = computed(() =>
  videoId.value ? youtubeEmbedUrl(videoId.value) : '',
)
const hasInput = computed(() => !!props.slide.url?.trim())

function patch(part: Partial<YoutubeLessonSlide>) {
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
      <label class="mb-1 block text-sm font-semibold text-aha-space">YouTube URL or video id</label>
      <a-input
        :value="slide.url"
        placeholder="https://www.youtube.com/watch?v=… or the 11-char id"
        class="rounded-aha"
        @update:value="(v: string) => patch({ url: v })"
      />
      <p
        v-if="hasInput && videoId"
        class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-aha-teal"
      >
        <CheckCircleFilled /> Recognised video id: {{ videoId }}
      </p>
      <p
        v-else-if="hasInput"
        class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-aha-carmine"
      >
        <WarningFilled /> Not a recognised YouTube URL or id.
      </p>
      <p v-else class="mt-1 text-xs text-aha-indigo">
        Paste a watch / youtu.be / shorts / embed link.
      </p>
    </div>
    <div v-if="embedUrl">
      <label class="mb-1 block text-sm font-semibold text-aha-space">Preview</label>
      <div
        class="relative w-full overflow-hidden rounded-aha bg-black"
        style="padding-top: 56.25%"
      >
        <iframe
          class="absolute inset-0 h-full w-full"
          :src="embedUrl"
          title="YouTube preview"
          frameborder="0"
          allowfullscreen
        />
      </div>
    </div>
  </div>
</template>
