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
  ShareAltOutlined,
  CopyOutlined,
  LinkOutlined,
  StopOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons-vue'
import {
  fetchLessonDetail,
  saveLessonDetail,
  reorderLesson,
  deleteQuestionPair,
  regenerateQuestion,
  regenerateLesson,
  markLessonReviewed,
  fetchPublishState,
  setLessonAuthMode,
  publishLesson,
  updatePublishedLesson,
  unpublishLesson,
  type AuthMode,
  type PublishState,
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
  // Load the publishing surface (slug, auth mode, status). Non-fatal.
  try {
    publishState.value = await fetchPublishState(lessonId)
  } catch {
    /* publishing controls just stay hidden/disabled */
  }
})

// ── Publishing (WAT-12) ────────────────────────────────────────────────────

const publishState = ref<PublishState | null>(null)
const publishing = ref(false)
const updatingPublished = ref(false)
const unpublishing = ref(false)
const authModeSaving = ref(false)
const shareModalOpen = ref(false)
const copied = ref(false)

const AUTH_MODE_OPTIONS: { value: AuthMode; label: string; hint: string }[] = [
  { value: 'anonymous', label: 'Anonymous', hint: 'No identifier — learners start instantly.' },
  { value: 'name', label: 'Name only', hint: 'Ask the learner for their name.' },
  { value: 'email', label: 'Email required', hint: 'Ask for a valid email address.' },
]

const isPublished = computed(() => publishState.value?.status === 'published')
const isUnpublished = computed(() => publishState.value?.status === 'unpublished')
const isReviewed = computed(() => !!lesson.value?.reviewed)
const hasDraftChanges = computed(() => !!publishState.value?.hasDraftChanges)

/** The literal display link per spec; the working route is <origin>/learn/:slug. */
const shareDisplayUrl = computed(() =>
  publishState.value?.shareLinkSlug ? `ahaslides.com/learn/${publishState.value.shareLinkSlug}` : '',
)
const shareWorkingUrl = computed(() =>
  publishState.value?.shareLinkSlug
    ? `${window.location.origin}/learn/${publishState.value.shareLinkSlug}`
    : '',
)

/** The auth mode the selector reflects (publishState wins once loaded). */
const authMode = computed<AuthMode>(() => publishState.value?.authMode ?? 'name')

async function onAuthModeChange(mode: AuthMode) {
  if (!publishState.value || mode === publishState.value.authMode) return
  authModeSaving.value = true
  try {
    publishState.value = await setLessonAuthMode(lessonId, mode)
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not update sign-in mode')
  } finally {
    authModeSaving.value = false
  }
}

async function doPublish() {
  if (!isReviewed.value) return
  publishing.value = true
  try {
    publishState.value = await publishLesson(lessonId, authMode.value)
    if (lesson.value) lesson.value.status = 'published'
    shareModalOpen.value = true
    message.success('Lesson published')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Publish failed')
  } finally {
    publishing.value = false
  }
}

async function doUpdatePublished() {
  updatingPublished.value = true
  try {
    publishState.value = await updatePublishedLesson(lessonId)
    message.success('Published version updated')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Update failed')
  } finally {
    updatingPublished.value = false
  }
}

function confirmUnpublish() {
  Modal.confirm({
    title: 'Take this lesson offline?',
    content:
      'The share link will show "this lesson is not available" until you publish again. The same link is kept, and existing learner progress is preserved.',
    okText: 'Unpublish',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: () => doUnpublish(),
  })
}

async function doUnpublish() {
  unpublishing.value = true
  try {
    publishState.value = await unpublishLesson(lessonId)
    if (lesson.value) lesson.value.status = 'draft'
    message.success('Lesson taken offline')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Unpublish failed')
  } finally {
    unpublishing.value = false
  }
}

function openShareModal() {
  if (publishState.value?.shareLinkSlug) shareModalOpen.value = true
}

async function copyShareLink() {
  const url = shareWorkingUrl.value
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    // Fallback for environments without the async clipboard API.
    const ta = document.createElement('textarea')
    ta.value = url
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta)
  }
  copied.value = true
  message.success('Link copied')
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

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

      <!-- Publishing panel (WAT-12) -->
      <section class="publish-panel mb-6 rounded-aha border-2 border-aha-lavender bg-white px-5 py-4 shadow-aha-sm">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <ShareAltOutlined class="text-aha-purple" />
          <h2 class="text-sm font-extrabold uppercase tracking-wide text-aha-space">Publish &amp; share</h2>
          <a-tag v-if="isPublished" color="green" class="publish-badge ml-1">Published</a-tag>
          <a-tag v-else-if="isUnpublished" color="orange" class="publish-badge ml-1">Offline</a-tag>
          <a-tag v-else class="publish-badge ml-1">Draft</a-tag>
          <a-tag v-if="isPublished && hasDraftChanges" color="blue" class="draft-badge">Unpublished draft</a-tag>
        </div>

        <!-- Auth-mode selector (set before publishing) -->
        <div class="mb-4">
          <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-aha-indigo">
            Who can take it — sign-in
          </label>
          <a-radio-group
            :value="authMode"
            :disabled="authModeSaving"
            button-style="solid"
            class="auth-mode-group"
            @change="(e: any) => onAuthModeChange(e.target.value)"
          >
            <a-radio-button v-for="o in AUTH_MODE_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </a-radio-button>
          </a-radio-group>
          <p class="mt-1 text-xs text-aha-indigo">
            {{ AUTH_MODE_OPTIONS.find((o) => o.value === authMode)?.hint }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Not yet published → Publish (gated on reviewed) -->
          <a-tooltip
            v-if="!isPublished"
            :title="isReviewed ? '' : 'Review the lesson first — open and check the questions before publishing.'"
          >
            <a-button
              type="primary"
              class="publish-btn flex items-center"
              :loading="publishing"
              :disabled="!isReviewed"
              @click="doPublish"
            >
              <template #icon><CloudUploadOutlined /></template>
              {{ isUnpublished ? 'Re-publish' : 'Publish' }}
            </a-button>
          </a-tooltip>

          <!-- Published → show link, update-published (when draft changed), unpublish -->
          <template v-if="isPublished">
            <a-button class="view-link-btn flex items-center" @click="openShareModal">
              <template #icon><LinkOutlined /></template>
              Share link
            </a-button>
            <a-button
              v-if="hasDraftChanges"
              type="primary"
              class="update-published-btn flex items-center"
              :loading="updatingPublished"
              @click="doUpdatePublished"
            >
              <template #icon><CloudUploadOutlined /></template>
              Update published version
            </a-button>
            <a-button
              danger
              class="unpublish-btn flex items-center"
              :loading="unpublishing"
              @click="confirmUnpublish"
            >
              <template #icon><StopOutlined /></template>
              Unpublish
            </a-button>
          </template>
        </div>

        <p v-if="isPublished && hasDraftChanges" class="mt-2 text-xs text-aha-indigo">
          You've edited this lesson since it was published. Learners still see the live version until you click
          <strong>Update published version</strong>.
        </p>
      </section>

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

    <!-- Share-link modal (WAT-12) -->
    <a-modal
      v-model:open="shareModalOpen"
      title="Your lesson is live"
      :footer="null"
      class="share-modal"
    >
      <p class="mb-3 text-sm text-aha-indigo">
        Anyone with this link can take the lesson — no AhaSlides account needed.
      </p>
      <div class="flex items-center gap-2 rounded-aha border-2 border-aha-lavender bg-aha-blush px-3 py-2">
        <LinkOutlined class="text-aha-purple" />
        <code class="share-link-text flex-1 truncate text-sm font-semibold text-aha-space">
          {{ shareDisplayUrl }}
        </code>
        <a-button type="primary" class="copy-link-btn flex items-center" @click="copyShareLink">
          <template #icon><CopyOutlined /></template>
          {{ copied ? 'Copied!' : 'Copy' }}
        </a-button>
      </div>
      <p class="mt-3 text-xs text-aha-indigo">
        Sign-in: <strong>{{ AUTH_MODE_OPTIONS.find((o) => o.value === authMode)?.label }}</strong>.
        Re-publishing keeps this same link.
      </p>
    </a-modal>
  </main>
</template>
