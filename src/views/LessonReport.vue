<script setup lang="ts">
// LessonReport.vue — per-lesson report of ALL audience attempts (route
// /lesson/:id/report). Fetches GET /api/lessons/:id/attempts (D1) and shows:
//   - a summary (attempt count, average score),
//   - a table of attempts (audience name, when, score/total),
//   - a per-question breakdown with simple aggregates (% correct), built
//     entirely from the persisted response snapshots (the lesson definition
//     lives only in the creator's localStorage, so the report never depends on
//     it). Question grouping is keyed by slideId across all attempts.
//
// On-brand: Ant table + brand tokens. Handles loading / error / empty states.

import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue'
import { fetchAttempts, type Attempt } from '@/api/attempts'
import { fetchLesson } from '@/api/lessons-api'
import { type Lesson } from '@/lessons/lessons'

const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

// Lesson title comes from D1 when available; otherwise we fall back to a
// generic label. The report DATA never depends on the lesson definition.
const lesson = ref<Lesson | null>(null)
const lessonTitle = computed(() => lesson.value?.title ?? 'Lesson report')

const loading = ref(true)
const error = ref<string | null>(null)
const attempts = ref<Attempt[]>([])

async function load() {
  loading.value = true
  error.value = null
  try {
    const [a, l] = await Promise.all([
      fetchAttempts(lessonId),
      fetchLesson(lessonId).catch(() => null),
    ])
    attempts.value = a
    lesson.value = l
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the report.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Summary ─────────────────────────────────────────────────────────────────
const attemptCount = computed(() => attempts.value.length)
const avgScore = computed(() => {
  const scored = attempts.value.filter((a) => a.total > 0)
  if (!scored.length) return null
  const pct =
    scored.reduce((sum, a) => sum + a.score / a.total, 0) / scored.length
  return Math.round(pct * 100)
})

const dateFmt = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
function formatDate(iso: string): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

// ── Attempts table ────────────────────────────────────────────────────────────
const attemptColumns = [
  { title: 'Audience', dataIndex: 'audienceName', key: 'audienceName' },
  { title: 'When', dataIndex: 'createdAt', key: 'createdAt' },
  { title: 'Score', dataIndex: 'score', key: 'score', align: 'right' as const },
]

const attemptRows = computed(() =>
  attempts.value.map((a) => ({
    key: a.id,
    audienceName: a.audienceName || 'Anonymous',
    createdAt: formatDate(a.createdAt),
    score: a.total > 0 ? `${a.score} / ${a.total}` : '—',
  })),
)

// ── Per-question aggregates (built from response snapshots) ────────────────────
interface QuestionAgg {
  slideId: number
  question: string
  type: string
  answered: number
  correct: number
  /** % correct over answers that have a known correctness, or null. */
  correctPct: number | null
}

const questionAggs = computed<QuestionAgg[]>(() => {
  const bySlide = new Map<number, QuestionAgg>()
  // Preserve first-seen order across attempts (newest first → reverse for
  // stable ascending appearance of questions).
  for (const attempt of [...attempts.value].reverse()) {
    for (const r of attempt.responses) {
      let agg = bySlide.get(r.slideId)
      if (!agg) {
        agg = {
          slideId: r.slideId,
          question: r.question || `Slide ${r.slideId}`,
          type: r.type,
          answered: 0,
          correct: 0,
          correctPct: null,
        }
        bySlide.set(r.slideId, agg)
      }
      agg.answered += 1
      if (r.correct === true) agg.correct += 1
    }
  }
  const list = [...bySlide.values()]
  for (const agg of list) {
    agg.correctPct = agg.answered > 0 ? Math.round((agg.correct / agg.answered) * 100) : null
  }
  return list
})

function reload() {
  load()
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-10">
    <!-- Header -->
    <header class="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0 shrink-0">
        <h1 class="flex items-center gap-2 text-2xl font-extrabold text-aha-space">
          <BarChartOutlined class="shrink-0 text-aha-purple" />
          {{ lessonTitle }}
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">Lesson report — all audience attempts</p>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <a-button class="flex items-center" :loading="loading" @click="reload">
          <template #icon><ReloadOutlined /></template>
          Refresh
        </a-button>
        <a-button type="primary" class="flex items-center" @click="goHome">
          <template #icon><ArrowLeftOutlined /></template>
          My Lessons
        </a-button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-20">
      <a-spin size="large" />
    </div>

    <!-- Error -->
    <a-alert
      v-else-if="error"
      type="error"
      show-icon
      message="Could not load the report"
      :description="error"
      class="rounded-aha"
    />

    <!-- Empty -->
    <div
      v-else-if="!attemptCount"
      class="flex flex-col items-center rounded-aha bg-aha-blush px-6 py-16 text-center shadow-aha-sm"
    >
      <div class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-aha-lavender text-4xl text-aha-purple">
        <TeamOutlined />
      </div>
      <h2 class="mb-2 text-xl font-extrabold text-aha-space">No attempts yet</h2>
      <p class="max-w-md text-aha-indigo">
        When an audience takes this lesson, their responses will appear here.
        Share the lesson's Take link to collect attempts.
      </p>
    </div>

    <!-- Report -->
    <div v-else class="flex flex-col gap-8">
      <!-- Summary stats -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <a-card class="rounded-aha shadow-aha-sm" :body-style="{ padding: '16px' }">
          <a-statistic title="Attempts" :value="attemptCount">
            <template #prefix>
              <TeamOutlined class="text-aha-purple" />
            </template>
          </a-statistic>
        </a-card>
        <a-card class="rounded-aha shadow-aha-sm" :body-style="{ padding: '16px' }">
          <a-statistic
            title="Average score"
            :value="avgScore !== null ? avgScore : '—'"
            :suffix="avgScore !== null ? '%' : ''"
          >
            <template #prefix>
              <BarChartOutlined class="text-aha-purple" />
            </template>
          </a-statistic>
        </a-card>
      </div>

      <!-- Attempts table -->
      <section>
        <h2 class="mb-3 text-lg font-extrabold text-aha-space">Attempts</h2>
        <a-table
          :columns="attemptColumns"
          :data-source="attemptRows"
          :pagination="false"
          size="middle"
          class="rounded-aha"
        />
      </section>

      <!-- Per-question breakdown -->
      <section v-if="questionAggs.length">
        <h2 class="mb-3 text-lg font-extrabold text-aha-space">Question breakdown</h2>
        <div class="flex flex-col gap-3">
          <a-card
            v-for="q in questionAggs"
            :key="q.slideId"
            class="rounded-aha shadow-aha-sm"
            :body-style="{ padding: '16px' }"
          >
            <div class="mb-3 flex items-start justify-between gap-4">
              <h3 class="min-w-0 flex-1 font-semibold text-aha-space">
                {{ q.question }}
              </h3>
              <span
                v-if="q.correctPct !== null"
                class="shrink-0 rounded-full bg-aha-purple px-3 py-1 text-xs font-bold text-white"
              >
                {{ q.correctPct }}% correct
              </span>
            </div>
            <a-progress
              v-if="q.correctPct !== null"
              :percent="q.correctPct"
              stroke-color="#6A1EBB"
              trail-color="#D3B4FF"
              :stroke-width="10"
            />
            <p class="mt-2 text-xs text-aha-indigo">
              {{ q.correct }} of {{ q.answered }} answered correctly
            </p>
          </a-card>
        </div>
      </section>
    </div>
  </main>
</template>
