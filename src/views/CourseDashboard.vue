<script setup lang="ts">
/**
 * WAT-15 (Stage 7) — OWNER-facing Course progress dashboard.
 * Route: /courses/c/:courseId/dashboard (reached from the course detail page).
 *
 * Shows, for a whole course:
 *   (a) course-level stats — total joined, total completed, completion rate,
 *       average time-to-completion (over course learners who finished every
 *       member lesson);
 *   (b) per-lesson breakdown table — each member lesson with its started /
 *       completed / drop-off counts and completion rate;
 *   (c) drill-down — clicking a lesson opens its lesson-level dashboard.
 *
 * OWNER-ONLY — never linked from the public /learn routes. Refresh-on-load.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  RightOutlined,
} from '@ant-design/icons-vue'
import { fetchCourseAnalytics, type CourseAnalytics } from '@/api/courses-api'

const route = useRoute()
const router = useRouter()
const courseId = route.params.courseId as string

const data = ref<CourseAnalytics | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    data.value = await fetchCourseAnalytics(courseId)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the dashboard.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goBack() {
  router.push({ name: 'course-detail', params: { courseId }, query: route.query })
}

/** Drill into a member lesson's own dashboard. */
function openLesson(lessonId: string) {
  router.push({ name: 'lesson-dashboard', params: { id: lessonId }, query: route.query })
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

const stats = computed(() => data.value?.stats ?? null)
const isAnonymous = computed(() => data.value?.anonymous === true)
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <!-- Top bar -->
    <div class="mb-6 flex items-center justify-between gap-3">
      <a-button class="flex items-center" @click="goBack">
        <template #icon><ArrowLeftOutlined /></template>
        Course
      </a-button>
      <a-button class="flex items-center" :loading="loading" @click="load">
        <template #icon><ReloadOutlined /></template>
        Refresh
      </a-button>
    </div>

    <a-alert
      v-if="loadError"
      type="error"
      show-icon
      message="Could not load dashboard"
      :description="loadError"
      class="mb-4 rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="load">Retry</a-button>
      </template>
    </a-alert>

    <a-spin :spinning="loading && !data">
      <template v-if="data">
        <header class="mb-6">
          <h1 class="text-2xl font-bold text-aha-space">{{ data.course.title }}</h1>
          <p class="mt-1 text-sm text-aha-indigo">
            Course progress dashboard
            <span class="mx-1">·</span>
            <span class="capitalize">{{ data.course.authMode }}</span> mode
          </p>
        </header>

        <!-- Course-level stats -->
        <section class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <TeamOutlined /> <span class="text-xs">Joined</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="course-joined">
              {{ stats?.joined ?? 0 }}
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <CheckCircleOutlined /> <span class="text-xs">Completed</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="course-completed">
              {{ stats?.completed ?? 0 }}
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <CheckCircleOutlined /> <span class="text-xs">Completion rate</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-purple" data-testid="course-rate">
              {{ stats?.completionRate ?? 0 }}%
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <ClockCircleOutlined /> <span class="text-xs">Avg time</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="course-avg-time">
              {{ fmtDuration(stats?.avgTimeToCompleteSeconds ?? null) }}
            </div>
          </a-card>
        </section>

        <a-alert
          v-if="isAnonymous"
          type="info"
          show-icon
          class="mb-6 rounded-aha"
          data-testid="course-anonymous-notice"
          message="Anonymous course — aggregate stats only"
          description="This course collects no learner identifiers; per-learner detail is not available. Numbers are aggregate."
        />

        <!-- Per-lesson breakdown -->
        <section>
          <h2 class="mb-3 text-lg font-semibold text-aha-space">Lessons</h2>
          <a-empty
            v-if="!data.lessons.length"
            description="This course has no lessons yet."
          />
          <a-table
            v-else
            data-testid="lesson-breakdown-table"
            size="middle"
            :pagination="false"
            :data-source="data.lessons"
            :row-key="(r: any) => r.lessonId"
            :columns="[
              { title: 'Lesson', key: 'title' },
              { title: 'Started', dataIndex: 'started', key: 'started', align: 'right' },
              { title: 'Completed', dataIndex: 'completed', key: 'completed', align: 'right' },
              { title: 'Drop-off', dataIndex: 'dropOff', key: 'dropOff', align: 'right' },
              { title: 'Rate', key: 'rate', align: 'right' },
              { title: '', key: 'drill', align: 'right' },
            ]"
            :custom-row="(record: any) => ({ onClick: () => openLesson(record.lessonId), style: 'cursor: pointer' })"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">
                <span class="font-medium text-aha-space">{{ record.title }}</span>
              </template>
              <template v-else-if="column.key === 'dropOff'">
                <span :class="record.dropOff > 0 ? 'text-aha-carmine' : 'text-aha-indigo'">
                  {{ record.dropOff }}
                </span>
              </template>
              <template v-else-if="column.key === 'rate'">
                <span class="font-medium text-aha-purple">{{ record.completionRate }}%</span>
              </template>
              <template v-else-if="column.key === 'drill'">
                <RightOutlined class="text-aha-indigo" />
              </template>
            </template>
          </a-table>
          <p class="mt-2 text-xs text-aha-indigo">Click a lesson to drill into its dashboard.</p>
        </section>
      </template>
    </a-spin>
  </main>
</template>
