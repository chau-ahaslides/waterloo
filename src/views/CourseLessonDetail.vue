<script setup lang="ts">
/**
 * WAT-10 — Placeholder lesson detail page (/courses/lessons/:id).
 *
 * This is a STAGE 2 placeholder. The full lesson playback experience is Stage 3
 * (WAT-11). For now this page simply shows the lesson id and a "coming soon"
 * message so the /courses home cards can link somewhere meaningful.
 */
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftOutlined, ReadOutlined } from '@ant-design/icons-vue'

const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

function goBack() {
  router.push({ name: 'courses-home', query: route.query })
}
</script>

<template>
  <main class="flex min-h-[100dvh] w-full flex-col items-center justify-center px-6">
    <div class="max-w-lg w-full text-center">
      <div
        class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple"
      >
        <ReadOutlined />
      </div>
      <h1 class="mb-2 text-2xl font-extrabold text-aha-space">Lesson Detail</h1>
      <p class="mb-1 text-sm text-aha-indigo">Lesson id: <code class="font-mono text-xs">{{ lessonId }}</code></p>
      <p class="mb-6 text-aha-indigo">
        The full lesson playback experience is coming in Stage 3 (WAT-11).
        Stay tuned!
      </p>
      <a-button class="flex items-center" @click="goBack">
        <template #icon><ArrowLeftOutlined /></template>
        Back to Courses
      </a-button>
    </div>
  </main>
</template>
