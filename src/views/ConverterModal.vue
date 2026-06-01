<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CheckCircleFilled,
  FileTextOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import {
  fetchPresentationList,
  type Presentation,
  type SortColumn,
  type SortOrder,
} from '@/api/presentations'
import {
  addLessons,
  convertPresentationToLesson,
  type Lesson,
} from '@/lessons/lessons'
import { ahaPalettes } from '@/theme/brandTokens'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created', lessons: Lesson[]): void
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<Presentation[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const sortColumn = ref<SortColumn>('lastEditedAt')
const sortOrder = ref<SortOrder>('desc')

// Selected presentation ids.
const selected = ref<Set<number>>(new Set())
const converting = ref(false)
const convertMsg = ref<string | null>(null)

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
    error.value =
      e instanceof Error ? e.message : 'Failed to load presentations.'
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// Load the list the first time the modal opens, and reset transient state.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      convertMsg.value = null
      if (!items.value.length) load()
    }
  },
)

watch([page, sortColumn, sortOrder], load)
watch([sortColumn, sortOrder], () => {
  page.value = 1
})

function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const selectedCount = computed(() => selected.value.size)

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

function close() {
  emit('update:open', false)
}

async function confirm() {
  if (!selectedCount.value || converting.value) return
  converting.value = true
  convertMsg.value = null
  const byId = new Map(items.value.map((p) => [p.id, p]))
  const created: Lesson[] = []
  const skipped: string[] = []
  const failed: string[] = []

  for (const id of selected.value) {
    const pres = byId.get(id)
    const name = pres?.name || `Presentation ${id}`
    try {
      const lesson = await convertPresentationToLesson(id, name)
      if (lesson) created.push(lesson)
      else skipped.push(name)
    } catch {
      failed.push(name)
    }
  }

  converting.value = false

  if (created.length) {
    // Persist to localStorage, then notify the parent for in-memory update.
    addLessons(created)
    emit('created', created)
  }

  const parts: string[] = []
  if (created.length)
    parts.push(`${created.length} lesson${created.length === 1 ? '' : 's'} created`)
  if (skipped.length)
    parts.push(`${skipped.length} skipped (no supported slides)`)
  if (failed.length) parts.push(`${failed.length} failed`)

  if (created.length && !skipped.length && !failed.length) {
    // Clean success — close and reset selection.
    selected.value = new Set()
    close()
  } else {
    convertMsg.value = parts.join(' · ') || 'Nothing converted.'
  }
}
</script>

<template>
  <a-modal
    :open="props.open"
    title="Create lessons from presentations"
    width="900px"
    :footer="null"
    :mask-closable="!converting"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="m-0 text-sm text-aha-indigo">
        Pick one or more presentations. Each becomes a lesson built from its
        <span class="font-semibold text-aha-space">supported</span> slides
        (quiz questions and content slides).
      </p>
      <div class="flex shrink-0 items-center gap-2">
        <a-select
          v-model:value="sortColumn"
          :options="sortOptions"
          size="small"
          style="width: 140px"
        />
        <a-select v-model:value="sortOrder" size="small" style="width: 130px">
          <a-select-option value="desc">Newest first</a-select-option>
          <a-select-option value="asc">Oldest first</a-select-option>
        </a-select>
        <a-button size="small" :loading="loading" class="flex items-center" @click="load">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </div>
    </div>

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

    <div
      v-if="loading"
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <a-card v-for="n in 6" :key="n" class="rounded-aha">
        <a-skeleton active :paragraph="{ rows: 1 }" />
      </a-card>
    </div>

    <a-empty
      v-else-if="!error && !items.length"
      description="No presentations found"
      class="py-10"
    />

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
        @click="toggle(p.id)"
      >
        <span
          v-if="selected.has(p.id)"
          class="absolute right-2 top-2 z-10 text-xl text-aha-purple"
        >
          <CheckCircleFilled />
        </span>
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
          <h4
            class="mb-1 truncate font-semibold text-aha-space"
            :title="p.name"
          >
            {{ p.name || 'Untitled' }}
          </h4>
          <div class="flex items-center gap-1 text-xs text-aha-indigo">
            <span class="inline-flex items-center gap-1"><FileTextOutlined /> {{ p.slideCount }} slides</span>
            <a-tag class="m-0 ml-auto font-mono">{{ p.accessCode }}</a-tag>
          </div>
        </div>
      </button>
    </div>

    <div v-if="!error && total > pageSize" class="mt-4 flex justify-center">
      <a-pagination
        v-model:current="page"
        :total="total"
        :page-size="pageSize"
        :show-size-changer="false"
        :disabled="loading || converting"
        size="small"
      />
    </div>

    <a-alert
      v-if="convertMsg"
      type="info"
      show-icon
      :message="convertMsg"
      class="mt-4 rounded-aha"
    />

    <div class="mt-6 flex items-center justify-between gap-4 border-t pt-4">
      <span class="text-sm text-aha-indigo">
        {{ selectedCount }} selected
      </span>
      <div class="flex items-center gap-2">
        <a-button :disabled="converting" @click="close">Cancel</a-button>
        <a-button
          type="primary"
          :loading="converting"
          :disabled="!selectedCount"
          @click="confirm"
        >
          Convert to lesson{{ selectedCount === 1 ? '' : 's' }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>
