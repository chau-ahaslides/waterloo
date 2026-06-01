<script setup lang="ts">
/**
 * WAT-10 — Courses home page (/courses).
 *
 * Lists the user's AI-generated (normalized) lessons: title, status badge,
 * created date. When none exist, shows a welcome message + "Create your first
 * lesson" CTA. A "New lesson" button at the top opens the CourseConverter modal.
 *
 * This page is the COURSES-FEATURE home (WAT-10). The existing "/" home
 * (Home.vue / WAT-1) remains unchanged and coexists — see FLAG comment below.
 */
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  BookOutlined,
  PlusOutlined,
  ReadOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue'
import { fetchNormalizedLessons, type NormalizedLesson } from '@/api/courses-api'
import { ahaPalettes } from '@/theme/brandTokens'
import CourseConverter from '@/views/CourseConverter.vue'

const router = useRouter()
const route = useRoute()

const lessons = ref<NormalizedLesson[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const converterOpen = ref(false)

async function loadAll() {
  loading.value = true
  loadError.value = null
  try {
    lessons.value = await fetchNormalizedLessons()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load your lessons.'
    lessons.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

/** Called by the converter when it finishes; reload the full list. */
async function onConverted() {
  await loadAll()
}

function openLesson(lesson: NormalizedLesson) {
  router.push({ name: 'courses-lesson-detail', params: { id: lesson.id }, query: route.query })
}

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
function formatDate(iso: string): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

const swatches = ahaPalettes.vibrant
function lessonColor(lesson: NormalizedLesson): string {
  // Use sourcePresentationId for deterministic colour; fall back to hash of id.
  const seed =
    lesson.sourcePresentationId ??
    lesson.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return swatches[Math.abs(seed) % swatches.length]
}
</script>

<!--
  FLAG (WAT-10): "/" (old Home.vue, WAT-1 legacy flow) and "/courses" (this page,
  WAT-10 Courses feature) now COEXIST. The old flow uses client-side extraction of
  pick-answer slides → legacy lessons table; the new flow uses the AI convert
  endpoint → normalized lessons + lesson_slides. They are separate pipelines.
  QUESTION FOR REQUESTER: should "/courses" eventually become the primary home
  (replacing "/")? Or should both remain as parallel entry points? Please confirm
  before we make "/courses" the default — we have not silently replaced "/".
-->

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <header class="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0 shrink-0">
        <h1 class="flex items-center gap-2 text-2xl font-extrabold text-aha-space">
          <BookOutlined class="shrink-0 text-aha-purple" />
          My Courses
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">
          {{ lessons.length }} lesson{{ lessons.length === 1 ? '' : 's' }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-3">
        <a-button type="primary" class="flex items-center" @click="converterOpen = true">
          <template #icon><PlusOutlined /></template>
          New lesson
        </a-button>
      </div>
    </header>

    <!-- Load error -->
    <a-alert
      v-if="loadError"
      type="error"
      show-icon
      message="Could not load lessons"
      :description="loadError"
      class="mb-4 rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="loadAll">Retry</a-button>
      </template>
    </a-alert>

    <!-- Loading skeletons -->
    <div
      v-else-if="loading"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <a-card v-for="n in 3" :key="n" class="rounded-aha shadow-aha-sm">
        <a-skeleton active :paragraph="{ rows: 2 }" />
      </a-card>
    </div>

    <!-- Welcome / empty state -->
    <div
      v-else-if="!lessons.length"
      class="flex flex-col items-center rounded-aha bg-aha-blush px-6 py-16 text-center shadow-aha-sm"
    >
      <div
        class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple"
      >
        <ReadOutlined />
      </div>
      <h2 class="mb-2 text-xl font-extrabold text-aha-space">
        Welcome to Courses!
      </h2>
      <p class="mb-6 max-w-md text-aha-indigo">
        You don't have any AI-generated lessons yet. Select a presentation and
        we'll generate comprehension questions and explanations automatically.
      </p>
      <a-button type="primary" size="large" class="flex items-center" @click="converterOpen = true">
        <template #icon><PlusOutlined /></template>
        Create your first lesson
      </a-button>
    </div>

    <!-- Lessons grid -->
    <div
      v-else
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <a-card
        v-for="l in lessons"
        :key="l.id"
        hoverable
        class="overflow-hidden rounded-aha shadow-aha-sm transition-shadow hover:shadow-aha-md"
        :body-style="{ padding: '16px' }"
        @click="openLesson(l)"
      >
        <template #cover>
          <div
            class="!flex h-28 w-full items-center justify-center text-3xl font-extrabold text-white"
            :style="{ backgroundColor: lessonColor(l) }"
          >
            <ReadOutlined />
          </div>
        </template>

        <div class="mb-1 flex items-center gap-2">
          <h3
            class="min-w-0 flex-1 truncate font-semibold text-aha-space"
            :title="l.title"
          >
            {{ l.title }}
          </h3>
          <a-tag
            :color="l.status === 'published' ? 'green' : 'default'"
            class="m-0 shrink-0 capitalize"
          >
            {{ l.status }}
          </a-tag>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-aha-indigo">
          <span class="inline-flex items-center gap-1">
            <BookOutlined /> {{ l.slideCount }} slide{{ l.slideCount === 1 ? '' : 's' }}
          </span>
          <span
            v-if="l.estimatedDurationMinutes"
            class="inline-flex items-center gap-1"
          >
            <ClockCircleOutlined /> ~{{ l.estimatedDurationMinutes }} min
          </span>
          <span>{{ formatDate(l.createdAt) }}</span>
        </div>
      </a-card>
    </div>

    <CourseConverter
      v-model:open="converterOpen"
      @converted="onConverted"
    />
  </main>
</template>
