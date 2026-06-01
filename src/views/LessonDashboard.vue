<script setup lang="ts">
/**
 * WAT-15 (Stage 7) — OWNER-facing Lesson progress dashboard.
 * Route: /courses/lessons/:id/dashboard (reached from the lesson detail page).
 *
 * Shows, for a single lesson:
 *   (a) stats cards — total joined, total completed, completion rate;
 *   (b) per-learner list (identifier, status, timestamps) for identified lessons;
 *       ANONYMOUS lessons show an aggregate-only card and NO per-learner rows;
 *   (c) per-question response distribution (option counts + % correct, with the
 *       single most-missed question flagged);
 *   (d) average time-to-completion vs. the lesson's estimated duration.
 *
 * OWNER-ONLY — never linked from the public /learn routes. Refresh-on-load
 * (Phase 1): the data is fetched on mount and via the Refresh button.
 *
 * Relationship to the legacy Report (/lesson/:id/report): that page reports the
 * original audience `attempts` table; THIS dashboard reports the Courses-program
 * learner tables (learner_progress / learner_responses). They are intentionally
 * separate analytics surfaces over different data models.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue'
import { fetchLessonAnalytics, type LessonAnalytics } from '@/api/courses-api'

const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

const data = ref<LessonAnalytics | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    data.value = await fetchLessonAnalytics(lessonId)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the dashboard.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goBack() {
  router.push({ name: 'courses-lesson-detail', params: { id: lessonId }, query: route.query })
}

/** Format a seconds duration as a compact "Xm Ys" / "Xs" string. */
function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

const stats = computed(() => data.value?.stats ?? null)
const isAnonymous = computed(() => data.value?.anonymous === true)

/** Estimated duration as seconds for a like-for-like comparison, or null. */
const estimatedSeconds = computed(() => {
  const m = stats.value?.estimatedDurationMinutes
  return typeof m === 'number' ? m * 60 : null
})

const statusTag: Record<string, string> = {
  completed: 'green',
  'in-progress': 'blue',
  joined: 'default',
}
const statusLabel: Record<string, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  joined: 'Joined',
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <!-- Top bar -->
    <div class="mb-6 flex items-center justify-between gap-3">
      <a-button class="flex items-center" @click="goBack">
        <template #icon><ArrowLeftOutlined /></template>
        Lesson
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
          <h1 class="text-2xl font-bold text-aha-space">{{ data.lesson.title }}</h1>
          <p class="mt-1 text-sm text-aha-indigo">
            Learner progress dashboard
            <span class="mx-1">·</span>
            <span class="capitalize">{{ data.lesson.authMode }}</span> mode
          </p>
        </header>

        <!-- Stats cards -->
        <section class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <TeamOutlined /> <span class="text-xs">Joined</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="stat-joined">
              {{ stats?.joined ?? 0 }}
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <CheckCircleOutlined /> <span class="text-xs">Completed</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="stat-completed">
              {{ stats?.completed ?? 0 }}
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <CheckCircleOutlined /> <span class="text-xs">Completion rate</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-purple" data-testid="stat-rate">
              {{ stats?.completionRate ?? 0 }}%
            </div>
          </a-card>
          <a-card class="rounded-aha" :body-style="{ padding: '16px' }">
            <div class="flex items-center gap-2 text-aha-indigo">
              <ClockCircleOutlined /> <span class="text-xs">Avg time</span>
            </div>
            <div class="mt-1 text-2xl font-bold text-aha-space" data-testid="stat-avg-time">
              {{ fmtDuration(stats?.avgTimeToCompleteSeconds ?? null) }}
            </div>
            <div class="mt-1 text-xs text-aha-indigo">
              est. {{ estimatedSeconds !== null ? fmtDuration(estimatedSeconds) : '—' }}
            </div>
          </a-card>
        </section>

        <!-- Anonymous notice -->
        <a-alert
          v-if="isAnonymous"
          type="info"
          show-icon
          class="mb-6 rounded-aha"
          data-testid="anonymous-notice"
          message="Anonymous lesson — aggregate stats only"
          description="This lesson collects no learner identifiers, so a per-learner list is not available. The numbers above and the question distribution below are aggregate."
        />

        <!-- Per-learner list (identified lessons only) -->
        <section v-if="!isAnonymous && data.learners" class="mb-8">
          <h2 class="mb-3 text-lg font-semibold text-aha-space">Learners</h2>
          <a-table
            v-if="data.learners.length"
            data-testid="learner-table"
            size="middle"
            :pagination="false"
            :data-source="data.learners"
            :row-key="(r: any) => r.identifier + r.startedAt"
            :columns="[
              { title: 'Learner', dataIndex: 'identifier', key: 'identifier' },
              { title: 'Status', key: 'status' },
              { title: 'Started', key: 'startedAt' },
              { title: 'Completed', key: 'completedAt' },
            ]"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'identifier'">
                {{ record.identifier || 'Anonymous' }}
              </template>
              <template v-else-if="column.key === 'status'">
                <a-tag :color="statusTag[record.status]">{{ statusLabel[record.status] }}</a-tag>
              </template>
              <template v-else-if="column.key === 'startedAt'">
                {{ fmtDate(record.startedAt) }}
              </template>
              <template v-else-if="column.key === 'completedAt'">
                {{ fmtDate(record.completedAt) }}
              </template>
            </template>
          </a-table>
          <a-empty v-else description="No learners have joined this lesson yet." />
        </section>

        <!-- Per-question response distribution -->
        <section>
          <h2 class="mb-3 text-lg font-semibold text-aha-space">Question responses</h2>
          <a-empty
            v-if="!data.questions.length"
            description="This lesson has no question slides."
          />
          <div v-else class="flex flex-col gap-4">
            <a-card
              v-for="q in data.questions"
              :key="q.order"
              class="rounded-aha"
              :body-style="{ padding: '16px' }"
              data-testid="question-card"
            >
              <div class="mb-3 flex items-start justify-between gap-3">
                <div class="font-semibold text-aha-space">
                  Q{{ q.order / 2 + 1 }}. {{ q.question }}
                </div>
                <a-tag v-if="q.mostMissed" color="error" class="flex items-center gap-1 shrink-0">
                  <WarningOutlined /> Most missed
                </a-tag>
              </div>
              <div class="mb-3 text-xs text-aha-indigo">
                {{ q.totalResponses }} response{{ q.totalResponses === 1 ? '' : 's' }}
                <span class="mx-1">·</span>
                <span class="font-medium text-aha-purple">{{ q.correctRate }}% correct</span>
              </div>
              <div class="flex flex-col gap-2">
                <div
                  v-for="opt in q.options"
                  :key="opt.index"
                  class="flex items-center gap-3"
                  data-testid="option-row"
                >
                  <div class="flex w-1/2 items-center gap-2 text-sm">
                    <CheckCircleOutlined v-if="opt.isCorrect" class="text-aha-teal" />
                    <span :class="opt.isCorrect ? 'font-medium text-aha-space' : 'text-aha-indigo'">
                      {{ opt.label }}
                    </span>
                  </div>
                  <div class="flex-1">
                    <div class="h-3 w-full overflow-hidden rounded-aha bg-aha-sky">
                      <div
                        class="h-full rounded-aha"
                        :class="opt.isCorrect ? 'bg-aha-teal' : 'bg-aha-lavender'"
                        :style="{
                          width:
                            (q.totalResponses
                              ? Math.round((opt.count / q.totalResponses) * 100)
                              : 0) + '%',
                        }"
                      />
                    </div>
                  </div>
                  <div class="w-10 text-right text-sm tabular-nums text-aha-indigo">
                    {{ opt.count }}
                  </div>
                </div>
              </div>
            </a-card>
          </div>
        </section>
      </template>
    </a-spin>
  </main>
</template>
