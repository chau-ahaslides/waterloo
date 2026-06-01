<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AppstoreOutlined,
  ReloadOutlined,
  TeamOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue'
import {
  fetchPresentationList,
  getToken,
  type Presentation,
  type SortColumn,
  type SortOrder,
} from '@/api/presentations'
import { ahaPalettes } from '@/theme/brandTokens'

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<Presentation[]>([])
const total = ref(0)

const page = ref(1)
const pageSize = ref(50) // API returns 50 per page
const sortColumn = ref<SortColumn>('lastEditedAt')
const sortOrder = ref<SortOrder>('desc')

const hasToken = computed(() => !!getToken())

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

onMounted(load)
watch([page, sortColumn, sortOrder], load)

// Reset to the first page whenever the sort changes.
watch([sortColumn, sortOrder], () => {
  page.value = 1
})

const dateFmt = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
function formatDate(iso: string): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

// Deterministic on-brand colour for the thumbnail placeholder.
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
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-extrabold text-aha-space">
          <AppstoreOutlined class="text-aha-purple" />
          Presentations
        </h1>
        <p class="mt-1 text-sm text-aha-indigo">
          {{ total }} presentation{{ total === 1 ? '' : 's' }}
        </p>
      </div>

      <a-space :size="12">
        <a-select v-model:value="sortColumn" :options="sortOptions" style="width: 150px" />
        <a-select v-model:value="sortOrder" style="width: 130px">
          <a-select-option value="desc">Newest first</a-select-option>
          <a-select-option value="asc">Oldest first</a-select-option>
        </a-select>
        <a-button :loading="loading" @click="load">
          <template #icon><ReloadOutlined /></template>
          Refresh
        </a-button>
      </a-space>
    </header>

    <!-- No token -->
    <a-alert
      v-if="!hasToken"
      type="warning"
      show-icon
      message="No token provided"
      description="Add ?token=<your-jwt> to the URL to load presentations."
      class="rounded-aha"
    />

    <!-- Error -->
    <a-alert
      v-else-if="error"
      type="error"
      show-icon
      :message="error"
      class="rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="load">Retry</a-button>
      </template>
    </a-alert>

    <!-- Loading skeletons -->
    <div
      v-else-if="loading"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <a-card v-for="n in 6" :key="n" class="rounded-aha shadow-aha-sm">
        <a-skeleton active :paragraph="{ rows: 2 }" />
      </a-card>
    </div>

    <!-- Empty -->
    <a-empty v-else-if="!items.length" description="No presentations found" class="py-16" />

    <!-- Grid -->
    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <a-card
        v-for="p in items"
        :key="p.id"
        hoverable
        class="overflow-hidden rounded-aha shadow-aha-sm transition-shadow hover:shadow-aha-md"
        :body-style="{ padding: '16px' }"
      >
        <template #cover>
          <div class="relative h-32 w-full">
            <img
              v-if="p.customThumbnailImage || p.thumbnailImage"
              :src="(p.customThumbnailImage || p.thumbnailImage) as string"
              :alt="p.name"
              class="h-32 w-full object-cover"
            />
            <div
              v-else
              class="flex h-32 w-full items-center justify-center text-3xl font-extrabold text-white"
              :style="{ backgroundColor: thumbColor(p) }"
            >
              {{ initials(p.name) }}
            </div>
            <a-tag
              v-if="p.presenting"
              color="green"
              class="absolute right-2 top-2 m-0"
            >
              Live
            </a-tag>
          </div>
        </template>

        <h3 class="mb-1 truncate font-semibold text-aha-space" :title="p.name">
          {{ p.name || 'Untitled' }}
        </h3>
        <div class="mb-3 flex items-center gap-3 text-xs text-aha-indigo">
          <span class="inline-flex items-center gap-1">
            <FileTextOutlined /> {{ p.slideCount }} slides
          </span>
          <span class="inline-flex items-center gap-1">
            <TeamOutlined /> {{ p.participantsCount }}
          </span>
        </div>
        <div class="flex items-center justify-between text-xs text-aha-indigo">
          <a-tag class="m-0 font-mono">{{ p.accessCode }}</a-tag>
          <span>{{ formatDate(p.lastEditedAt) }}</span>
        </div>
      </a-card>
    </div>

    <div v-if="hasToken && !error && total > pageSize" class="mt-8 flex justify-center">
      <a-pagination
        v-model:current="page"
        :total="total"
        :page-size="pageSize"
        :show-size-changer="false"
        :disabled="loading"
      />
    </div>
  </main>
</template>
