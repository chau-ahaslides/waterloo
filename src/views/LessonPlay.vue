<script setup lang="ts">
// LessonPlay.vue — PREVIEW run of a lesson (route /lesson/:id/play).
//
// This is the local, non-submitting preview: it embeds the shared LessonPlayer
// for playback and shows its own completion screen with a "try again" button.
// The real audience run (TakeLesson.vue, /lesson/:id/take) reuses the SAME
// LessonPlayer but submits the attempt to D1 — there is one player, not two.

import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftOutlined, CloseCircleFilled, TrophyOutlined } from '@ant-design/icons-vue'
import { loadLessons, type Lesson } from '@/lessons/lessons'
import LessonPlayer from '@/views/LessonPlayer.vue'

// ── Route params ──────────────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

// ── Load lesson ───────────────────────────────────────────────────────────────
const lesson = loadLessons().find((l: Lesson) => l.id === lessonId) ?? null

// ── Completion state (preview: local only, no submit) ──────────────────────────
const completed = ref(false)
const score = ref(0)
const totalScored = ref(0)
const playerRef = ref<InstanceType<typeof LessonPlayer> | null>(null)

function onComplete(payload: { score: number; total: number }) {
  score.value = payload.score
  totalScored.value = payload.total
  completed.value = true
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}

function restart() {
  completed.value = false
  score.value = 0
  totalScored.value = 0
  playerRef.value?.restart()
}
</script>

<template>
  <!-- ── Unknown lesson ─────────────────────────────────────────────────────── -->
  <main
    v-if="!lesson"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
      <CloseCircleFilled />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Lesson not found</h1>
    <p class="text-aha-indigo">This lesson may have been deleted or the link is invalid.</p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Empty lesson ───────────────────────────────────────────────────────── -->
  <main
    v-else-if="lesson.slides.length === 0"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
      <TrophyOutlined />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Nothing to preview</h1>
    <p class="text-aha-indigo">
      This lesson has no slides yet. Convert a presentation with supported slides first.
    </p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Completion screen ──────────────────────────────────────────────────── -->
  <main
    v-else-if="completed"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-24 w-24 items-center justify-center rounded-full bg-aha-teal/20 text-5xl text-aha-teal">
      <TrophyOutlined />
    </div>
    <h1 class="text-3xl font-extrabold text-aha-space">
      {{ totalScored > 0 && score === totalScored ? '🎉 Perfect!' : 'Lesson complete!' }}
    </h1>
    <p v-if="totalScored > 0" class="text-xl text-aha-indigo">
      You got
      <span class="font-extrabold text-aha-purple">{{ score }}/{{ totalScored }}</span>
      correct
    </p>
    <p v-else class="text-xl text-aha-indigo">You've reached the end.</p>
    <div class="flex items-center gap-3">
      <a-button @click="restart">Try again</a-button>
      <a-button type="primary" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
        Back to My Lessons
      </a-button>
    </div>
  </main>

  <!-- ── Active lesson (shared player) ──────────────────────────────────────── -->
  <LessonPlayer
    v-else
    ref="playerRef"
    :lesson="lesson"
    @complete="onComplete"
    @back="goHome"
  />
</template>
