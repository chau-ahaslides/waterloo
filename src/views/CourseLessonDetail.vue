<script setup lang="ts">
/**
 * WAT-11 — Lesson detail / editor (/courses/lessons/:id).
 *
 * The trainer reviews + edits an AI-converted lesson before publishing. The AI
 * is a first draft; the trainer is the editor. This page:
 *   - Inline-editable title + auto-suggested-but-overridable estimated duration.
 *   - Lists all slides in order (Q/E interleaved), grouped into Q+E "cards".
 *   - Edit IN PLACE: question text / 4 options / which option is correct;
 *     explanation text.
 *   - Per Q+E pair: reorder (drag, or up/down), delete (min 3 enforced),
 *     regenerate-individually (one fresh grounded Q+E from the source deck).
 *   - "Regenerate all" (confirm: edits lost) → regenerates the whole lesson.
 *   - "Save draft" + autosave (debounced) for inline edits.
 *   - On first open, marks the lesson `reviewed` (Stage 4 publish gates on it).
 *
 * STAGE-1 STRUCTURE NOTE: the 10Q+10E shape is fixed in Stage 1. Here the
 * trainer can DELETE questions to shorten (min 3) but cannot ADD new ones yet.
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  HolderOutlined,
  ReloadOutlined,
  SaveOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  BulbOutlined,
} from '@ant-design/icons-vue'
import {
  fetchLessonDetail,
  saveLessonDetail,
  reorderLesson,
  deleteQuestionPair,
  regenerateQuestion,
  regenerateLesson,
  markLessonReviewed,
  type LessonDetail,
  type LessonSlide,
} from '@/api/courses-api'

const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

/** A question paired with its explanation — the editor's unit of work. */
interface Pair {
  question: LessonSlide
  explanation: LessonSlide | null
}

const lesson = ref<LessonDetail | null>(null)
const pairs = ref<Pair[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const saving = ref(false)
const dirty = ref(false)
const regeneratingAll = ref(false)
const regeneratingOrder = ref<number | null>(null)

/** Minimum questions a lesson must keep (mirrors the server floor). */
const MIN_QUESTIONS = 3

// ── Load ─────────────────────────────────────────────────────────────────────

/** Split the flat ordered slides into Q+E pairs (Q immediately followed by E). */
function toPairs(slides: LessonSlide[]): Pair[] {
  const sorted = [...slides].sort((a, b) => a.order - b.order)
  const out: Pair[] = []
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    if (s.type === 'question') {
      const next = sorted[i + 1]
      out.push({ question: s, explanation: next && next.type === 'explanation' ? next : null })
    }
  }
  return out
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const data = await fetchLessonDetail(lessonId)
    lesson.value = data.lesson
    pairs.value = toPairs(data.slides)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load this lesson.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  // Mark reviewed on first open (publish-gate for Stage 4). Fire-and-forget;
  // a failure here shouldn't block editing.
  if (lesson.value && !lesson.value.reviewed) {
    try {
      const data = await markLessonReviewed(lessonId)
      lesson.value = data.lesson
    } catch {
      /* non-fatal — the trainer can still edit */
    }
  }
})

// ── Title + duration ──────────────────────────────────────────────────────────

const questionCount = computed(() => pairs.value.length)

/** Auto-suggested duration: ~30s per slide (Q+E), min 1 minute. */
const suggestedDuration = computed(() => Math.max(1, Math.round(questionCount.value * 2 * 0.5)))

const durationOverridden = ref(false)
const durationInput = ref<number | null>(null)

watch(
  () => lesson.value?.estimatedDurationMinutes,
  (v) => {
    if (durationInput.value === null) durationInput.value = v ?? suggestedDuration.value
  },
)

// When questions change and the trainer hasn't overridden, follow the suggestion.
watch(suggestedDuration, (s) => {
  if (!durationOverridden.value) durationInput.value = s
})

function onTitleChange(v: string) {
  if (lesson.value) {
    lesson.value.title = v
    markDirty()
  }
}

function onDurationChange(v: number | null) {
  durationOverridden.value = true
  durationInput.value = v
  markDirty()
}

function useSuggestedDuration() {
  durationOverridden.value = false
  durationInput.value = suggestedDuration.value
  markDirty()
}

// ── Inline slide edits ─────────────────────────────────────────────────────────

function questionContent(p: Pair) {
  const c = p.question.content as { question?: string; options?: string[]; correct_index?: number }
  return {
    question: typeof c.question === 'string' ? c.question : '',
    options: Array.isArray(c.options) ? c.options : ['', '', '', ''],
    correct_index: typeof c.correct_index === 'number' ? c.correct_index : 0,
  }
}

function explanationText(p: Pair): string {
  const c = p.explanation?.content as { explanation?: string } | undefined
  return c && typeof c.explanation === 'string' ? c.explanation : ''
}

function setQuestionText(p: Pair, v: string) {
  const c = questionContent(p)
  p.question.content = { ...c, question: v }
  markDirty()
}

function setOption(p: Pair, i: number, v: string) {
  const c = questionContent(p)
  const options = [...c.options]
  options[i] = v
  p.question.content = { ...c, options }
  markDirty()
}

function setCorrect(p: Pair, i: number) {
  const c = questionContent(p)
  p.question.content = { ...c, correct_index: i }
  markDirty()
}

function setExplanation(p: Pair, v: string) {
  if (p.explanation) {
    p.explanation.content = { ...(p.explanation.content as object), explanation: v }
    markDirty()
  }
}

// ── Save (manual + debounced autosave) ─────────────────────────────────────────

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function markDirty() {
  dirty.value = true
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    void save(true)
  }, 1500)
}

async function save(isAutosave = false) {
  if (!lesson.value || saving.value) return
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  saving.value = true
  try {
    const slides = pairs.value.flatMap((p) =>
      [p.question, p.explanation].filter(Boolean).map((s) => ({
        id: (s as LessonSlide).id,
        content: (s as LessonSlide).content,
      })),
    )
    const data = await saveLessonDetail(lessonId, {
      title: lesson.value.title,
      estimatedDurationMinutes: durationInput.value,
      slides,
    })
    lesson.value = data.lesson
    pairs.value = toPairs(data.slides)
    dirty.value = false
    if (!isAutosave) message.success('Draft saved')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Save failed')
  } finally {
    saving.value = false
  }
}

// ── Reorder (drag + up/down) ────────────────────────────────────────────────────

const dragIndex = ref<number | null>(null)

function onDragStart(i: number) {
  dragIndex.value = i
}
function onDrop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === target) return
  movePair(from, target)
}

function movePair(from: number, to: number) {
  const next = [...pairs.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  pairs.value = next
  void persistOrder()
}

function moveUp(i: number) {
  if (i > 0) movePair(i, i - 1)
}
function moveDown(i: number) {
  if (i < pairs.value.length - 1) movePair(i, i + 1)
}

async function persistOrder() {
  try {
    const order = pairs.value.map((p) => p.question.id)
    const data = await reorderLesson(lessonId, order)
    pairs.value = toPairs(data.slides)
    lesson.value = data.lesson
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Reorder failed')
    await load()
  }
}

// ── Delete (min 3) ───────────────────────────────────────────────────────────

function confirmDelete(p: Pair) {
  if (questionCount.value <= MIN_QUESTIONS) {
    message.warning(`A lesson must keep at least ${MIN_QUESTIONS} questions — can't delete this one.`)
    return
  }
  Modal.confirm({
    title: 'Delete this question?',
    content: 'This removes the question and its paired explanation. This cannot be undone.',
    okText: 'Delete',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: () => doDelete(p),
  })
}

async function doDelete(p: Pair) {
  try {
    const data = await deleteQuestionPair(lessonId, p.question.order)
    pairs.value = toPairs(data.slides)
    lesson.value = data.lesson
    message.success('Question deleted')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Delete failed')
  }
}

// ── Regenerate ────────────────────────────────────────────────────────────────

async function regenOne(p: Pair) {
  regeneratingOrder.value = p.question.order
  try {
    const data = await regenerateQuestion(lessonId, p.question.order)
    pairs.value = toPairs(data.slides)
    lesson.value = data.lesson
    message.success('Question regenerated')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Regenerate failed')
  } finally {
    regeneratingOrder.value = null
  }
}

function confirmRegenAll() {
  Modal.confirm({
    title: 'Regenerate the entire lesson?',
    content:
      'This re-runs the AI on the source presentation and REPLACES every question and explanation. All your edits will be lost. This cannot be undone.',
    okText: 'Regenerate all',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: () => doRegenAll(),
  })
}

async function doRegenAll() {
  regeneratingAll.value = true
  try {
    const data = await regenerateLesson(lessonId)
    pairs.value = toPairs(data.slides)
    lesson.value = data.lesson
    durationOverridden.value = false
    durationInput.value = data.lesson.estimatedDurationMinutes ?? suggestedDuration.value
    dirty.value = false
    message.success('Lesson regenerated')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Regenerate failed')
  } finally {
    regeneratingAll.value = false
  }
}

function goBack() {
  router.push({ name: 'courses-home', query: route.query })
}

onBeforeUnmount(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
})

const optionLetters = ['A', 'B', 'C', 'D']
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <!-- Top bar -->
    <div class="mb-6 flex items-center justify-between gap-3">
      <a-button class="flex items-center" @click="goBack">
        <template #icon><ArrowLeftOutlined /></template>
        Courses
      </a-button>
      <div class="flex items-center gap-2">
        <span v-if="lesson?.reviewed" class="inline-flex items-center gap-1 text-xs text-aha-purple">
          <CheckCircleOutlined /> Reviewed
        </span>
        <a-button
          danger
          class="flex items-center"
          :loading="regeneratingAll"
          :disabled="loading || !lesson"
          @click="confirmRegenAll"
        >
          <template #icon><ReloadOutlined /></template>
          Regenerate all
        </a-button>
        <a-button
          type="primary"
          class="flex items-center"
          :loading="saving"
          :disabled="loading || !lesson"
          @click="save(false)"
        >
          <template #icon><SaveOutlined /></template>
          Save draft
        </a-button>
      </div>
    </div>

    <!-- Load error -->
    <a-alert
      v-if="loadError"
      type="error"
      show-icon
      message="Could not load lesson"
      :description="loadError"
      class="mb-4 rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="load">Retry</a-button>
      </template>
    </a-alert>

    <!-- Loading -->
    <div v-else-if="loading" class="flex flex-col gap-4">
      <a-skeleton active :paragraph="{ rows: 1 }" />
      <a-card v-for="n in 3" :key="n" class="rounded-aha shadow-aha-sm">
        <a-skeleton active :paragraph="{ rows: 3 }" />
      </a-card>
    </div>

    <template v-else-if="lesson">
      <!-- Title + duration header -->
      <header class="mb-6 rounded-aha bg-aha-blush px-5 py-4 shadow-aha-sm">
        <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-aha-indigo">
          Lesson title
        </label>
        <a-input
          :value="lesson.title"
          placeholder="Untitled lesson"
          class="mb-4 rounded-aha text-lg font-extrabold text-aha-space"
          size="large"
          @update:value="onTitleChange"
        />

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-aha-indigo">
              Estimated duration
            </label>
            <div class="flex items-center gap-2">
              <ClockCircleOutlined class="text-aha-purple" />
              <a-input-number
                :value="durationInput"
                :min="1"
                :max="600"
                :addon-after="'min'"
                class="rounded-aha"
                @update:value="onDurationChange"
              />
              <a-button
                v-if="durationOverridden && durationInput !== suggestedDuration"
                size="small"
                type="link"
                @click="useSuggestedDuration"
              >
                Use suggested ({{ suggestedDuration }} min)
              </a-button>
              <span v-else class="text-xs text-aha-indigo">
                Auto-suggested from {{ questionCount }} question{{ questionCount === 1 ? '' : 's' }}
              </span>
            </div>
          </div>

          <div class="text-xs text-aha-indigo">
            <span class="inline-flex items-center gap-1">
              <BulbOutlined />
              {{ questionCount }} question{{ questionCount === 1 ? '' : 's' }} + explanations
            </span>
            <span v-if="dirty" class="ml-3 italic">Unsaved changes…</span>
            <span v-else-if="saving" class="ml-3 italic">Saving…</span>
          </div>
        </div>
      </header>

      <!-- Min-questions hint -->
      <a-alert
        v-if="questionCount <= MIN_QUESTIONS"
        type="info"
        show-icon
        :message="`This lesson is at the minimum of ${MIN_QUESTIONS} questions — you can't delete any more.`"
        class="mb-4 rounded-aha"
      />

      <!-- Q+E pair cards -->
      <div class="flex flex-col gap-4">
        <a-card
          v-for="(p, i) in pairs"
          :key="p.question.id"
          class="rounded-aha shadow-aha-sm"
          :body-style="{ padding: '16px' }"
          draggable="true"
          :data-pair-index="i"
          @dragstart="onDragStart(i)"
          @dragover.prevent
          @drop="onDrop(i)"
        >
          <!-- Card header -->
          <div class="mb-3 flex items-center gap-2">
            <span class="cursor-grab text-aha-indigo" title="Drag to reorder">
              <HolderOutlined />
            </span>
            <span
              class="flex h-7 w-7 items-center justify-center rounded-full bg-aha-lavender text-sm font-bold text-aha-purple"
            >
              {{ i + 1 }}
            </span>
            <span class="text-sm font-semibold text-aha-space">Question {{ i + 1 }}</span>
            <div class="ml-auto flex items-center gap-1">
              <a-button
                size="small"
                type="text"
                :disabled="i === 0"
                title="Move up"
                class="reorder-up inline-flex items-center justify-center"
                @click="moveUp(i)"
              >
                <template #icon><ArrowUpOutlined /></template>
              </a-button>
              <a-button
                size="small"
                type="text"
                :disabled="i === pairs.length - 1"
                title="Move down"
                class="reorder-down inline-flex items-center justify-center"
                @click="moveDown(i)"
              >
                <template #icon><ArrowDownOutlined /></template>
              </a-button>
              <a-button
                size="small"
                :loading="regeneratingOrder === p.question.order"
                title="Regenerate this question from the source"
                class="regen-one inline-flex items-center"
                @click="regenOne(p)"
              >
                <template #icon><ReloadOutlined /></template>
                Regenerate
              </a-button>
              <a-button
                size="small"
                type="text"
                danger
                title="Delete this question + explanation"
                class="delete-pair inline-flex items-center justify-center"
                @click="confirmDelete(p)"
              >
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </div>
          </div>

          <!-- Question text -->
          <label class="mb-1 block text-xs font-semibold text-aha-indigo">Question</label>
          <a-textarea
            :value="questionContent(p).question"
            placeholder="Question text…"
            :auto-size="{ minRows: 1, maxRows: 4 }"
            class="mb-3 rounded-aha"
            @update:value="(v: string) => setQuestionText(p, v)"
          />

          <!-- Options -->
          <label class="mb-1 block text-xs font-semibold text-aha-indigo">
            Options <span class="font-normal">(select the correct answer)</span>
          </label>
          <div class="mb-3 flex flex-col gap-2">
            <div
              v-for="(opt, oi) in questionContent(p).options"
              :key="oi"
              class="flex items-center gap-2 rounded-aha border-2 px-3 py-2"
              :class="
                questionContent(p).correct_index === oi
                  ? 'border-aha-teal bg-aha-teal/5'
                  : 'border-aha-indigo/15 bg-white'
              "
            >
              <a-radio
                :checked="questionContent(p).correct_index === oi"
                class="correct-radio"
                @change="() => setCorrect(p, oi)"
              />
              <span class="w-5 shrink-0 text-center text-xs font-bold text-aha-indigo">
                {{ optionLetters[oi] }}
              </span>
              <a-input
                :value="opt"
                :placeholder="`Option ${optionLetters[oi]}`"
                class="flex-1 rounded-aha"
                @update:value="(v: string) => setOption(p, oi, v)"
              />
            </div>
          </div>

          <!-- Explanation -->
          <template v-if="p.explanation">
            <label class="mb-1 block text-xs font-semibold text-aha-indigo">Explanation</label>
            <a-textarea
              :value="explanationText(p)"
              placeholder="Explanation shown after the learner answers…"
              :auto-size="{ minRows: 2, maxRows: 6 }"
              class="rounded-aha"
              @update:value="(v: string) => setExplanation(p, v)"
            />
          </template>
        </a-card>
      </div>
    </template>
  </main>
</template>
