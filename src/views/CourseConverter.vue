<script setup lang="ts">
/**
 * WAT-10 — Course converter modal.
 *
 * Shows the user's presentation list with CHECKBOX multi-select. On Confirm,
 * calls POST /api/lessons/convert once per selected presentation (sequential,
 * ~10–30 s each via Workers AI). Shows detailed progress ("Converting 2 of 5:
 * <deck name>…") with a spinner/bar. When all finish, emits `converted` so the
 * parent (CoursesHome) can reload the lessons list.
 *
 * Partial-failure handling: each deck conversion is attempted independently.
 * Succeeded decks are counted + reported; failed decks show their error. The
 * user sees a summary of success/failure counts and can dismiss the modal.
 *
 * Reuses the presentation-list fetch logic from the existing legacy converter
 * (src/views/ConverterModal.vue) — same API client, same checkbox-card UI
 * pattern — but calls the NEW AI convert endpoint (POST /api/lessons/convert)
 * instead of the legacy client-side extraction.
 */
import { computed, ref, watch } from 'vue'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  FileTextOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import {
  fetchPresentationList,
  type Presentation,
  type SortColumn,
  type SortOrder,
} from '@/api/presentations'
import { convertPresentation } from '@/api/courses-api'
import { ahaPalettes } from '@/theme/brandTokens'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** Emitted once all conversions finish (some may have failed). */
  (e: 'converted'): void
}>()

// ── Presentation list state ──────────────────────────────────────────────────

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<Presentation[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const sortColumn = ref<SortColumn>('lastEditedAt')
const sortOrder = ref<SortOrder>('desc')

const sortOptions = [
  { label: 'Last edited', value: 'lastEditedAt' },
  { label: 'Date created', value: 'createdAt' },
  { label: 'Name', value: 'name' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchPresentationList({
      page: page.value,
      sortColumn: sortColumn.value,
      sortOrder: sortOrder.value,
      includeShared: true,
      folderId: '',
    })
    items.value = data.result
    total.value = data.numberOfPresentations
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load presentations.'
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// Load presentations the first time the modal opens.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // Reset conversion state on re-open.
      progressState.value = 'idle'
      progressIndex.value = 0
      progressTotal.value = 0
      progressCurrentName.value = ''
      successCount.value = 0
      failedNames.value = []
      if (!items.value.length) load()
    }
  },
)

watch([page, sortColumn, sortOrder], load)
watch([sortColumn, sortOrder], () => {
  page.value = 1
})

// ── Multi-select ────────────────────────────────────────────────────────────

const selected = ref<Set<number>>(new Set())
const selectedCount = computed(() => selected.value.size)

function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const swatches = ahaPalettes.vibrant
function thumbColor(p: Presentation): string {
  return swatches[p.id % swatches.length]
}
function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

// ── Conversion progress ──────────────────────────────────────────────────────

type ProgressState = 'idle' | 'running' | 'done'

const progressState = ref<ProgressState>('idle')
const progressIndex = ref(0)
const progressTotal = ref(0)
const progressCurrentName = ref('')
const successCount = ref(0)
const failedNames = ref<string[]>([])

const isConverting = computed(() => progressState.value === 'running')
const isDone = computed(() => progressState.value === 'done')

/** Progress bar percent (0–100). */
const progressPercent = computed(() =>
  progressTotal.value > 0
    ? Math.round((progressIndex.value / progressTotal.value) * 100)
    : 0,
)

const summaryMessage = computed(() => {
  if (!isDone.value) return null
  const parts: string[] = []
  if (successCount.value)
    parts.push(`${successCount.value} lesson${successCount.value === 1 ? '' : 's'} created`)
  if (failedNames.value.length)
    parts.push(`${failedNames.value.length} failed: ${failedNames.value.join(', ')}`)
  return parts.join(' · ') || 'No lessons created.'
})

function close() {
  if (isConverting.value) return
  emit('update:open', false)
}

async function confirm() {
  if (!selectedCount.value || isConverting.value) return

  const byId = new Map(items.value.map((p) => [p.id, p]))
  const ids = [...selected.value]

  progressState.value = 'running'
  progressTotal.value = ids.length
  progressIndex.value = 0
  successCount.value = 0
  failedNames.value = []

  for (const id of ids) {
    const pres = byId.get(id)
    const name = pres?.name || `Presentation ${id}`
    progressIndex.value += 1
    progressCurrentName.value = name

    try {
      await convertPresentation(id)
      successCount.value += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failedNames.value.push(name)
      console.warn(`Conversion failed for "${name}":`, msg)
    }
  }

  progressState.value = 'done'

  if (successCount.value > 0) {
    // Notify parent to reload the lesson list.
    emit('converted')

    // Auto-close cleanly if all succeeded; leave open so the user can see
    // the summary if there were any failures.
    if (!failedNames.value.length) {
      selected.value = new Set()
      emit('update:open', false)
    }
  }
}
</script>

<template>
  <a-modal
    :open="props.open"
    title="Create AI lessons from presentations"
    width="900px"
    :footer="null"
    :mask-closable="!isConverting"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <!-- Subtitle / description -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="m-0 text-sm text-aha-indigo">
        Select one or more presentations. Each becomes a lesson with
        <span class="font-semibold text-aha-space">AI-generated comprehension questions</span>
        (~10–30 s per deck).
      </p>
      <div class="flex shrink-0 items-center gap-2">
        <a-select
          v-model:value="sortColumn"
          :options="sortOptions"
          size="small"
          style="width: 140px"
          :disabled="isConverting"
        />
        <a-select v-model:value="sortOrder" size="small" style="width: 130px" :disabled="isConverting">
          <a-select-option value="desc">Newest first</a-select-option>
          <a-select-option value="asc">Oldest first</a-select-option>
        </a-select>
        <a-button size="small" :loading="loading" :disabled="isConverting" class="flex items-center" @click="load">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </div>
    </div>

    <!-- List load error -->
    <a-alert
      v-if="error"
      type="error"
      show-icon
      :message="error"
      class="mb-4 rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="load">Retry</a-button>
      </template>
    </a-alert>

    <!-- Loading skeletons -->
    <div
      v-if="loading"
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <a-card v-for="n in 6" :key="n" class="rounded-aha">
        <a-skeleton active :paragraph="{ rows: 1 }" />
      </a-card>
    </div>

    <!-- Empty -->
    <a-empty
      v-else-if="!error && !items.length"
      description="No presentations found"
      class="py-10"
    />

    <!-- Presentation grid with checkboxes -->
    <div
      v-else-if="!error"
      class="grid max-h-[50vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
    >
      <button
        v-for="p in items"
        :key="p.id"
        type="button"
        class="relative overflow-hidden rounded-aha border-2 bg-white text-left shadow-aha-sm transition-all hover:shadow-aha-md"
        :class="
          selected.has(p.id)
            ? 'border-aha-purple shadow-aha-purple'
            : 'border-transparent'
        "
        :disabled="isConverting"
        @click="toggle(p.id)"
      >
        <!-- Selected check -->
        <span
          v-if="selected.has(p.id)"
          class="absolute right-2 top-2 z-10 text-xl text-aha-purple"
        >
          <CheckCircleFilled />
        </span>
        <!-- Thumbnail -->
        <div class="relative h-24 w-full">
          <img
            v-if="p.customThumbnailImage || p.thumbnailImage"
            :src="(p.customThumbnailImage || p.thumbnailImage) as string"
            :alt="p.name"
            class="h-24 w-full object-cover"
          />
          <div
            v-else
            class="flex h-24 w-full items-center justify-center text-2xl font-extrabold text-white"
            :style="{ backgroundColor: thumbColor(p) }"
          >
            {{ initials(p.name) }}
          </div>
        </div>
        <div class="p-3">
          <h4 class="mb-1 truncate font-semibold text-aha-space" :title="p.name">
            {{ p.name || 'Untitled' }}
          </h4>
          <div class="flex items-center gap-1 text-xs text-aha-indigo">
            <span class="inline-flex items-center gap-1">
              <FileTextOutlined /> {{ p.slideCount }} slides
            </span>
            <a-tag class="m-0 ml-auto font-mono">{{ p.accessCode }}</a-tag>
          </div>
        </div>
      </button>
    </div>

    <!-- Pagination -->
    <div v-if="!error && total > pageSize" class="mt-4 flex justify-center">
      <a-pagination
        v-model:current="page"
        :total="total"
        :page-size="pageSize"
        :show-size-changer="false"
        :disabled="loading || isConverting"
        size="small"
      />
    </div>

    <!-- Conversion progress (visible while running and after done) -->
    <div v-if="isConverting || isDone" class="mt-4 rounded-aha border border-aha-lavender bg-aha-sky px-4 py-3">
      <!-- Running state -->
      <template v-if="isConverting">
        <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-aha-space">
          <LoadingOutlined class="text-aha-purple" />
          Converting {{ progressIndex }} of {{ progressTotal }}: <span class="truncate italic text-aha-indigo">{{ progressCurrentName }}</span>…
        </div>
        <a-progress
          :percent="progressPercent"
          :show-info="false"
          stroke-color="#6A1EBB"
          class="!m-0 block w-full"
        />
        <p class="mt-1 text-xs text-aha-indigo">
          Each deck takes ~10–30 s — please wait.
        </p>
      </template>
      <!-- Done state -->
      <template v-else-if="isDone">
        <div class="flex items-start gap-2 text-sm">
          <CheckCircleFilled
            v-if="!failedNames.length"
            class="mt-0.5 shrink-0 text-green-500"
          />
          <CloseCircleFilled
            v-else
            class="mt-0.5 shrink-0 text-red-500"
          />
          <span class="text-aha-space">{{ summaryMessage }}</span>
        </div>
      </template>
    </div>

    <!-- Footer -->
    <div class="mt-6 flex items-center justify-between gap-4 border-t pt-4">
      <span class="text-sm text-aha-indigo">
        {{ selectedCount }} selected
      </span>
      <div class="flex items-center gap-2">
        <a-button :disabled="isConverting" @click="close">Cancel</a-button>
        <a-button
          type="primary"
          :loading="isConverting"
          :disabled="!selectedCount || isDone"
          @click="confirm"
        >
          Confirm ({{ selectedCount }})
        </a-button>
      </div>
    </div>
  </a-modal>
</template>
