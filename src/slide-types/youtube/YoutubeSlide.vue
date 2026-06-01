<script setup lang="ts">
// YoutubeSlide.vue — renders ONE authored YouTube slide as an embedded iframe
// player (16:9, responsive). Parses the stored URL/id at render time; if it
// isn't a valid YouTube URL it shows a friendly notice instead of an iframe.
// Info-only; emits `continue` so the generic player advances.

import { computed } from 'vue'
import { ArrowRightOutlined } from '@ant-design/icons-vue'
import { parseYouTubeId, youtubeEmbedUrl, type YoutubeLessonSlide } from './module'

const props = defineProps<{
  slide: YoutubeLessonSlide
  showingFeedback?: boolean
  response?: null
}>()

const emit = defineEmits<{
  (e: 'continue'): void
}>()

const videoId = computed(() => parseYouTubeId(props.slide.url ?? ''))
const embedUrl = computed(() =>
  videoId.value ? youtubeEmbedUrl(videoId.value) : '',
)
</script>

<template>
  <div class="mx-auto w-full max-w-2xl">
    <article class="rounded-aha border-2 border-aha-indigo/10 bg-white p-8 shadow-aha-sm">
      <span
        class="mb-4 inline-flex items-center rounded-full bg-aha-lavender/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-aha-purple"
      >
        Video
      </span>
      <h2
        v-if="slide.heading"
        class="mb-4 text-2xl font-extrabold leading-snug text-aha-space sm:text-3xl"
      >
        {{ slide.heading }}
      </h2>
      <div
        v-if="embedUrl"
        class="relative w-full overflow-hidden rounded-aha bg-black"
        style="padding-top: 56.25%"
      >
        <iframe
          class="absolute inset-0 h-full w-full"
          :src="embedUrl"
          title="YouTube video player"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        />
      </div>
      <p v-else class="italic text-aha-indigo">
        No valid YouTube video set for this slide.
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
