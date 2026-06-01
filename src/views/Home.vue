<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  AppstoreOutlined,
  BookOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReadOutlined,
} from '@ant-design/icons-vue'
import { getToken } from '@/api/presentations'
import {
  deleteLesson,
  loadLessons,
  type Lesson,
} from '@/lessons/lessons'
import ConverterModal from '@/views/ConverterModal.vue'
import { ahaPalettes } from '@/theme/brandTokens'

const lessons = ref<Lesson[]>([])
const converterOpen = ref(false)

const hasToken = computed(() => !!getToken())

onMounted(() => {
  lessons.value = loadLessons()
})

function onCreated(created: Lesson[]) {
  // Newest lessons are prepended by the converter; merge into local state.
  lessons.value = [...created, ...lessons.value]
}

function removeLesson(id: string) {
  lessons.value = deleteLesson(id)
}

function questionCount(l: Lesson): number {
  return l.slides.length
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
      <div>
        <h1
          class="flex items-center gap-2 text-2xl font-extrabold text-aha-space"
        >
          <BookOutlined class="text-aha-purple" />
          My Lessons
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">
          {{ lessons.length }} lesson{{ lessons.length === 1 ? '' : 's' }}
        </p>
      </div>

      <a-space :size="12">
        <RouterLink :to="{ name: 'presentations', query: $route.query }">
          <a-button>
            <template #icon><AppstoreOutlined /></template>
            Presentations
          </a-button>
        </RouterLink>
        <a-button type="primary" :disabled="!hasToken" @click="converterOpen = true">
          <template #icon><PlusOutlined /></template>
          Create new lesson
        </a-button>
      </a-space>
    </header>

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
            class="flex h-28 w-full items-center justify-center text-3xl font-extrabold text-white"
            :style="{ backgroundColor: lessonColor(l) }"
          >
            <ReadOutlined />
          </div>
        </template>

        <h3
          class="mb-1 truncate font-semibold text-aha-space"
          :title="l.title"
        >
          {{ l.title }}
        </h3>
        <div class="mb-3 flex items-center gap-3 text-xs text-aha-indigo">
          <span class="inline-flex items-center gap-1">
            <BookOutlined /> {{ questionCount(l) }} question{{
              questionCount(l) === 1 ? '' : 's'
            }}
          </span>
          <span>{{ formatDate(l.createdAt) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <a-tag class="m-0 font-mono">#{{ l.presentationId }}</a-tag>
          <a-popconfirm
            title="Delete this lesson?"
            ok-text="Delete"
            cancel-text="Cancel"
            @confirm="removeLesson(l.id)"
          >
            <a-button type="text" danger size="small">
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
