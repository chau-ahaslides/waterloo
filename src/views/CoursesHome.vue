<script setup lang="ts">
/**
 * WAT-10 + WAT-14 — Courses home page (/courses).
 *
 * Two sections via tabs:
 *   - "Lessons" (WAT-10) — the user's AI-generated (normalized) lessons grid,
 *     with a "New lesson" button opening the CourseConverter modal.
 *   - "Courses" (WAT-14) — the COURSE containers that group multiple lessons
 *     behind one share link, with a "New course" button opening NewCourseModal.
 *
 * This page is the COURSES-FEATURE home. The existing "/" home (Home.vue / WAT-1)
 * remains unchanged and coexists — see FLAG comment below.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  BookOutlined,
  PlusOutlined,
  ReadOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue'
import {
  fetchNormalizedLessons,
  fetchCourses,
  type NormalizedLesson,
  type CourseSummary,
} from '@/api/courses-api'
import { ahaPalettes } from '@/theme/brandTokens'
import CourseConverter from '@/views/CourseConverter.vue'
import NewCourseModal from '@/views/NewCourseModal.vue'

const router = useRouter()
const route = useRoute()

const activeTab = ref<'lessons' | 'courses'>('lessons')

// ── Lessons ───────────────────────────────────────────────────────────────
const lessons = ref<NormalizedLesson[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const converterOpen = ref(false)

async function loadLessons() {
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

// ── Courses ─────────────────────────────────────────────────────────────────
const courses = ref<CourseSummary[]>([])
const coursesLoading = ref(false)
const coursesError = ref<string | null>(null)
const newCourseOpen = ref(false)

async function loadCourses() {
  coursesLoading.value = true
  coursesError.value = null
  try {
    courses.value = await fetchCourses()
  } catch (e) {
    coursesError.value = e instanceof Error ? e.message : 'Could not load your courses.'
    courses.value = []
  } finally {
    coursesLoading.value = false
  }
}

onMounted(() => {
  void loadLessons()
  void loadCourses()
})

async function onConverted() {
  await loadLessons()
}

function onCourseCreated(courseId: string) {
  void loadCourses()
  router.push({ name: 'course-detail', params: { courseId }, query: route.query })
}

function openLesson(lesson: NormalizedLesson) {
  router.push({ name: 'courses-lesson-detail', params: { id: lesson.id }, query: route.query })
}

function openCourse(course: CourseSummary) {
  router.push({ name: 'course-detail', params: { courseId: course.id }, query: route.query })
}

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
function formatDate(iso: string): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

const swatches = ahaPalettes.vibrant
function lessonColor(lesson: NormalizedLesson): string {
  const seed =
    lesson.sourcePresentationId ??
    lesson.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return swatches[Math.abs(seed) % swatches.length]
}
function courseColor(course: CourseSummary): string {
  const seed = course.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return swatches[Math.abs(seed) % swatches.length]
}

function statusColor(status: string): string {
  return status === 'published' ? 'green' : status === 'unpublished' ? 'orange' : 'default'
}

const publishedLessonCount = computed(
  () => lessons.value.filter((l) => l.status === 'published').length,
)
</script>

<!--
  FLAG (WAT-10): "/" (old Home.vue, WAT-1 legacy flow) and "/courses" (this page)
  COEXIST. QUESTION FOR REQUESTER unchanged from WAT-10: should "/courses"
  eventually become the primary home? Not silently replaced.
-->

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0 shrink-0">
        <h1 class="flex items-center gap-2 text-2xl font-extrabold text-aha-space">
          <BookOutlined class="shrink-0 text-aha-purple" />
          My Courses
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">
          {{ lessons.length }} lesson{{ lessons.length === 1 ? '' : 's' }} ·
          {{ courses.length }} course{{ courses.length === 1 ? '' : 's' }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-3">
        <a-button
          v-if="activeTab === 'lessons'"
          type="primary"
          class="flex items-center"
          @click="converterOpen = true"
        >
          <template #icon><PlusOutlined /></template>
          New lesson
        </a-button>
        <a-button
          v-else
          type="primary"
          class="flex items-center"
          data-testid="new-course-btn"
          @click="newCourseOpen = true"
        >
          <template #icon><PlusOutlined /></template>
          New course
        </a-button>
      </div>
    </header>

    <a-tabs v-model:activeKey="activeTab">
      <!-- ── Lessons tab ─────────────────────────────────────────────────── -->
      <a-tab-pane key="lessons">
        <template #tab>
          <span class="inline-flex items-center gap-1">
            <ReadOutlined /> Lessons
          </span>
        </template>

        <a-alert
          v-if="loadError"
          type="error"
          show-icon
          message="Could not load lessons"
          :description="loadError"
          class="mb-4 rounded-aha"
        >
          <template #action>
            <a-button size="small" type="primary" @click="loadLessons">Retry</a-button>
          </template>
        </a-alert>

        <div
          v-else-if="loading"
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <a-card v-for="n in 3" :key="n" class="rounded-aha shadow-aha-sm">
            <a-skeleton active :paragraph="{ rows: 2 }" />
          </a-card>
        </div>

        <div
          v-else-if="!lessons.length"
          class="flex flex-col items-center rounded-aha bg-aha-blush px-6 py-16 text-center shadow-aha-sm"
        >
          <div
            class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple"
          >
            <ReadOutlined />
          </div>
          <h2 class="mb-2 text-xl font-extrabold text-aha-space">Welcome to Courses!</h2>
          <p class="mb-6 max-w-md text-aha-indigo">
            You don't have any AI-generated lessons yet. Select a presentation and we'll
            generate comprehension questions and explanations automatically.
          </p>
          <a-button type="primary" size="large" class="flex items-center" @click="converterOpen = true">
            <template #icon><PlusOutlined /></template>
            Create your first lesson
          </a-button>
        </div>

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <h3 class="min-w-0 flex-1 truncate font-semibold text-aha-space" :title="l.title">
                {{ l.title }}
              </h3>
              <a-tag :color="statusColor(l.status)" class="m-0 shrink-0 capitalize">{{ l.status }}</a-tag>
            </div>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-aha-indigo">
              <span class="inline-flex items-center gap-1">
                <BookOutlined /> {{ l.slideCount }} slide{{ l.slideCount === 1 ? '' : 's' }}
              </span>
              <span v-if="l.estimatedDurationMinutes" class="inline-flex items-center gap-1">
                <ClockCircleOutlined /> ~{{ l.estimatedDurationMinutes }} min
              </span>
              <span>{{ formatDate(l.createdAt) }}</span>
            </div>
          </a-card>
        </div>
      </a-tab-pane>

      <!-- ── Courses tab ─────────────────────────────────────────────────── -->
      <a-tab-pane key="courses">
        <template #tab>
          <span class="inline-flex items-center gap-1" data-testid="courses-tab">
            <AppstoreOutlined /> Courses
          </span>
        </template>

        <a-alert
          v-if="coursesError"
          type="error"
          show-icon
          message="Could not load courses"
          :description="coursesError"
          class="mb-4 rounded-aha"
        >
          <template #action>
            <a-button size="small" type="primary" @click="loadCourses">Retry</a-button>
          </template>
        </a-alert>

        <div
          v-else-if="coursesLoading"
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <a-card v-for="n in 3" :key="n" class="rounded-aha shadow-aha-sm">
            <a-skeleton active :paragraph="{ rows: 2 }" />
          </a-card>
        </div>

        <div
          v-else-if="!courses.length"
          class="flex flex-col items-center rounded-aha bg-aha-blush px-6 py-16 text-center shadow-aha-sm"
        >
          <div
            class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple"
          >
            <AppstoreOutlined />
          </div>
          <h2 class="mb-2 text-xl font-extrabold text-aha-space">Build your first course</h2>
          <p class="mb-6 max-w-md text-aha-indigo">
            Group several lessons into one course and share it with a single link. Learners
            work through the lessons at their own pace.
          </p>
          <a-button
            type="primary"
            size="large"
            class="flex items-center"
            data-testid="new-course-empty-btn"
            @click="newCourseOpen = true"
          >
            <template #icon><PlusOutlined /></template>
            New course
          </a-button>
        </div>

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <a-card
            v-for="c in courses"
            :key="c.id"
            hoverable
            class="overflow-hidden rounded-aha shadow-aha-sm transition-shadow hover:shadow-aha-md"
            :body-style="{ padding: '16px' }"
            data-testid="course-card"
            @click="openCourse(c)"
          >
            <template #cover>
              <div
                class="!flex h-28 w-full items-center justify-center text-3xl font-extrabold text-white"
                :style="{ backgroundColor: courseColor(c) }"
              >
                <AppstoreOutlined />
              </div>
            </template>

            <div class="mb-1 flex items-center gap-2">
              <h3 class="min-w-0 flex-1 truncate font-semibold text-aha-space" :title="c.title">
                {{ c.title }}
              </h3>
              <a-tag :color="statusColor(c.status)" class="m-0 shrink-0 capitalize">{{ c.status }}</a-tag>
            </div>

            <p v-if="c.description" class="mb-2 line-clamp-2 text-xs text-aha-indigo">
              {{ c.description }}
            </p>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-aha-indigo">
              <span class="inline-flex items-center gap-1">
                <ReadOutlined /> {{ c.lessonCount }} lesson{{ c.lessonCount === 1 ? '' : 's' }}
              </span>
              <span v-if="c.totalDurationMinutes" class="inline-flex items-center gap-1">
                <ClockCircleOutlined /> ~{{ c.totalDurationMinutes }} min
              </span>
              <a-tag class="m-0 capitalize" :bordered="false">{{ c.orderMode }}</a-tag>
            </div>
          </a-card>
        </div>
      </a-tab-pane>
    </a-tabs>

    <CourseConverter v-model:open="converterOpen" @converted="onConverted" />
    <NewCourseModal
      v-model:open="newCourseOpen"
      :published-lesson-count="publishedLessonCount"
      @created="onCourseCreated"
    />
  </main>
</template>
