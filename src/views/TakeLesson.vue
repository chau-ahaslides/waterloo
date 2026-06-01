<script setup lang="ts">
// TakeLesson.vue — the REAL audience run of a lesson (route /lesson/:id/take).
//
// Same one-at-a-time, per-type playback as the preview (it embeds the SHARED
// LessonPlayer), but this is the live run that SUBMITS:
//   1. Start screen — optional free-text audience name, then "Start".
//   2. Playback — via LessonPlayer (collects per-slide response snapshots).
//   3. On completion — POST the attempt to /api/lessons/:id/attempts (D1),
//      then show a confirmation + a link to the report. Audience can retake;
//      each run posts a NEW attempt (multiple attempts per lesson allowed).

import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  CloseCircleFilled,
  LoadingOutlined,
  RocketOutlined,
  TrophyOutlined,
} from '@ant-design/icons-vue'
import { type Lesson } from '@/lessons/lessons'
import { fetchLesson } from '@/api/lessons-api'
import { submitAttempt, type AttemptResponse } from '@/api/attempts'
import LessonPlayer from '@/views/LessonPlayer.vue'

// ── Route params ──────────────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

// ── Load lesson (from D1) ───────────────────────────────────────────────────────
const lesson = ref<Lesson | null>(null)
const loadingLesson = ref(true)

onMounted(async () => {
  try {
    lesson.value = await fetchLesson(lessonId)
  } finally {
    loadingLesson.value = false
  }
})

// ── Phase state ───────────────────────────────────────────────────────────────
type Phase = 'start' | 'playing' | 'submitting' | 'done'
const phase = ref<Phase>('start')
const audienceName = ref('')

// ── Result + submission state ──────────────────────────────────────────────────
const score = ref(0)
const totalScored = ref(0)
const submitError = ref<string | null>(null)
const playerRef = ref<InstanceType<typeof LessonPlayer> | null>(null)

function start() {
  phase.value = 'playing'
}

async function onComplete(payload: {
  score: number
  total: number
  responses: AttemptResponse[]
}) {
  score.value = payload.score
  totalScored.value = payload.total
  phase.value = 'submitting'
  submitError.value = null
  try {
    await submitAttempt(lessonId, {
      audienceName: audienceName.value.trim() || null,
      score: payload.score,
      total: payload.total,
      responses: payload.responses,
    })
    phase.value = 'done'
  } catch (e) {
    submitError.value =
      e instanceof Error ? e.message : 'Could not submit your answers.'
    phase.value = 'done'
  }
}

function retake() {
  score.value = 0
  totalScored.value = 0
  submitError.value = null
  phase.value = 'playing'
  // Reset the player after it re-mounts on the next tick.
  requestAnimationFrame(() => playerRef.value?.restart())
}

function goReport() {
  router.push({ name: 'lesson-report', params: { id: lessonId }, query: route.query })
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}
</script>

<template>
  <!-- ── Loading ────────────────────────────────────────────────────────────── -->
  <main
    v-if="loadingLesson"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="text-5xl text-aha-purple"><LoadingOutlined spin /></div>
    <h1 class="text-xl font-extrabold text-aha-space">Loading lesson…</h1>
  </main>

  <!-- ── Unknown lesson ─────────────────────────────────────────────────────── -->
  <main
    v-else-if="!lesson"
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
    <h1 class="text-2xl font-extrabold text-aha-space">Nothing to take</h1>
    <p class="text-aha-indigo">
      This lesson has no slides yet. Convert a presentation with supported slides first.
    </p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Start screen ───────────────────────────────────────────────────────── -->
  <main
    v-else-if="phase === 'start'"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="flex h-24 w-24 items-center justify-center rounded-full bg-aha-lavender text-5xl text-aha-purple">
      <RocketOutlined />
    </div>
    <h1 class="text-3xl font-extrabold text-aha-space">{{ lesson.title }}</h1>
    <p class="max-w-md text-aha-indigo">
      Answer each question to complete the lesson. Your answers will be saved to
      the lesson report.
    </p>
    <div class="flex w-full max-w-sm flex-col gap-3">
      <a-input
        v-model:value="audienceName"
        size="large"
        placeholder="Your name (optional)"
        :maxlength="120"
        class="rounded-aha"
        @keyup.enter="start"
      />
      <a-button type="primary" size="large" class="flex items-center justify-center" @click="start">
        <template #icon><RocketOutlined /></template>
        Start lesson
      </a-button>
    </div>
  </main>

  <!-- ── Playback (shared player) ───────────────────────────────────────────── -->
  <LessonPlayer
    v-else-if="phase === 'playing'"
    ref="playerRef"
    :lesson="lesson"
    @complete="onComplete"
    @back="goHome"
  />

  <!-- ── Submitting ─────────────────────────────────────────────────────────── -->
  <main
    v-else-if="phase === 'submitting'"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="text-5xl text-aha-purple">
      <LoadingOutlined spin />
    </div>
    <h1 class="text-2xl font-extrabold text-aha-space">Submitting your answers…</h1>
  </main>

  <!-- ── Completion / done ──────────────────────────────────────────────────── -->
  <main
    v-else
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

    <!-- Submission confirmation / error -->
    <a-alert
      v-if="submitError"
      type="error"
      show-icon
      message="Your answers could not be saved"
      :description="submitError"
      class="max-w-md rounded-aha text-left"
    />
    <a-alert
      v-else
      type="success"
      show-icon
      message="Your answers were saved to the lesson report."
      class="max-w-md rounded-aha"
    />

    <div class="flex flex-wrap items-center justify-center gap-3">
      <a-button class="flex items-center" @click="retake">Take again</a-button>
      <a-button type="primary" class="flex items-center" @click="goReport">
        <template #icon><TrophyOutlined /></template>
        View report
      </a-button>
      <a-button type="text" class="flex items-center" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
        My Lessons
      </a-button>
    </div>
  </main>
</template>
