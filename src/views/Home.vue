<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  AppstoreOutlined,
  BarChartOutlined,
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReadOutlined,
  RocketOutlined,
} from '@ant-design/icons-vue'
import { getToken } from '@/api/presentations'
import { type Lesson } from '@/lessons/lessons'
import { deleteLesson, fetchLessons } from '@/api/lessons-api'
import ConverterModal from '@/views/ConverterModal.vue'
import { ahaPalettes } from '@/theme/brandTokens'

const lessons = ref<Lesson[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const converterOpen = ref(false)
const route = useRoute()
const router = useRouter()

const hasToken = computed(() => !!getToken())

async function loadAll() {
  loading.value = true
  loadError.value = null
  try {
    lessons.value = await fetchLessons()
  } catch (e) {
    loadError.value =
      e instanceof Error ? e.message : 'Could not load your lessons.'
    lessons.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

function onCreated(created: Lesson[]) {
  // Newest lessons are prepended by the converter; merge into local state.
  lessons.value = [...created, ...lessons.value]
}

async function removeLesson(id: string) {
  await deleteLesson(id)
  lessons.value = lessons.value.filter((l) => l.id !== id)
}

function editLesson(l: Lesson) {
  router.push({ name: 'lesson-edit', params: { id: l.id }, query: route.query })
}

function questionCount(l: Lesson): number {
  return l.slides.length
}

function previewLesson(l: Lesson) {
  router.push({ name: 'lesson-play', params: { id: l.id }, query: route.query })
}

function takeLesson(l: Lesson) {
  router.push({ name: 'lesson-take', params: { id: l.id }, query: route.query })
}

function reportLesson(l: Lesson) {
  router.push({ name: 'lesson-report', params: { id: l.id }, query: route.query })
}

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
function formatDate(iso: string): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

const swatches = ahaPalettes.vibrant
function lessonColor(l: Lesson): string {
  return swatches[l.presentationId % swatches.length]
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <header class="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0 shrink-0">
        <h1
          class="flex items-center gap-2 text-2xl font-extrabold text-aha-space"
        >
          <BookOutlined class="shrink-0 text-aha-purple" />
          My Lessons
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">
          {{ lessons.length }} lesson{{ lessons.length === 1 ? '' : 's' }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-3">
        <RouterLink :to="{ name: 'presentations', query: $route.query }">
          <a-button class="flex items-center">
            <template #icon><AppstoreOutlined /></template>
            Presentations
          </a-button>
        </RouterLink>
        <a-button type="primary" :disabled="!hasToken" class="flex items-center" @click="converterOpen = true">
          <template #icon><PlusOutlined /></template>
          Create new lesson
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

    <!-- No token -->
    <a-alert
      v-if="!hasToken"
      type="warning"
      show-icon
      message="No token provided"
      description="Add ?token=<your-jwt> to the URL, then create a lesson from one of your presentations."
      class="rounded-aha"
    />

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
        Welcome! Let’s build your first lesson
      </h2>
      <p class="mb-6 max-w-md text-aha-indigo">
        You don’t have any lessons yet. Turn one of your presentations into a
        lesson — we’ll pull in its pick-answer quiz slides for you.
      </p>
      <a-button type="primary" size="large" @click="converterOpen = true">
        <template #icon><PlusOutlined /></template>
        Create new lesson
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
        class="overflow-hidden rounded-aha shadow-aha-sm transition-shadow hover:shadow-aha-md"
        :body-style="{ padding: '16px' }"
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
        <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-aha-indigo">
          <span class="inline-flex items-center gap-1">
            <BookOutlined /> {{ questionCount(l) }} slide{{
              questionCount(l) === 1 ? '' : 's'
            }}
          </span>
          <span>{{ formatDate(l.createdAt) }}</span>
          <span class="font-mono">#{{ l.presentationId }}</span>
        </div>
        <!--
          Action row wraps (flex-wrap): five compact actions don't fit on one
          line at the 3-column card width, so without wrapping the row overflows
          the overflow-hidden card and Report/delete get clipped (WAT-3 r3 fix).
        -->
        <div class="flex flex-wrap items-center gap-1">
          <a-button
            size="small"
            class="inline-flex items-center"
            @click="editLesson(l)"
          >
            <template #icon><EditOutlined /></template>
            Edit
          </a-button>
          <a-button
            size="small"
            class="inline-flex items-center"
            @click="previewLesson(l)"
          >
            <template #icon><PlayCircleOutlined /></template>
            Preview
          </a-button>
          <a-button
            type="primary"
            size="small"
            class="inline-flex items-center"
            @click="takeLesson(l)"
          >
            <template #icon><RocketOutlined /></template>
            Take
          </a-button>
          <a-button
            size="small"
            class="inline-flex items-center"
            @click="reportLesson(l)"
          >
            <template #icon><BarChartOutlined /></template>
            Report
          </a-button>
          <a-popconfirm
            title="Delete this lesson?"
            ok-text="Delete"
            cancel-text="Cancel"
            @confirm="removeLesson(l.id)"
          >
            <a-button type="text" danger size="small" class="ml-auto inline-flex items-center justify-center">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </a-popconfirm>
        </div>
      </a-card>
    </div>

    <ConverterModal
      v-model:open="converterOpen"
      @created="onCreated"
    />
  </main>
</template>
