<script setup lang="ts">
/**
 * WAT-14 — "New course" modal.
 *
 * Flow:
 *   (a) title + description,
 *   (b) pick >=1 existing lessons to add, with drag-and-drop ordering of the
 *       picked set (native HTML5 drag, same pattern as CourseLessonDetail),
 *   (c) order mode: Free (default) | Sequential,
 *   (d) auth mode: anonymous | name (default) | email,
 *   (e) Save → POST /api/courses creates a DRAFT course (+ ordered members).
 *
 * Only PUBLISHED lessons can be meaningfully delivered inside a published
 * course, but we let the trainer add any lesson here (draft lessons just won't
 * appear in the public course until they're published) — we surface a hint.
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  HolderOutlined,
  DeleteOutlined,
  PlusOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue'
import {
  fetchNormalizedLessons,
  createCourse,
  type NormalizedLesson,
  type OrderMode,
  type AuthMode,
} from '@/api/courses-api'

const props = defineProps<{ open: boolean; publishedLessonCount?: number }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created', courseId: string): void
}>()

const title = ref('')
const description = ref('')
const orderMode = ref<OrderMode>('free')
const authMode = ref<AuthMode>('name')

const allLessons = ref<NormalizedLesson[]>([])
const loadingLessons = ref(false)
const loadError = ref<string | null>(null)
// Ordered list of picked lesson ids (drag reorders this).
const pickedIds = ref<string[]>([])
const saving = ref(false)

const lessonById = computed<Record<string, NormalizedLesson>>(() => {
  const map: Record<string, NormalizedLesson> = {}
  for (const l of allLessons.value) map[l.id] = l
  return map
})

const availableLessons = computed(() =>
  allLessons.value.filter((l) => !pickedIds.value.includes(l.id)),
)
const pickedLessons = computed(() =>
  pickedIds.value.map((id) => lessonById.value[id]).filter(Boolean),
)
const totalDuration = computed(() =>
  pickedLessons.value.reduce((sum, l) => sum + (l.estimatedDurationMinutes ?? 0), 0),
)

const canSave = computed(() => title.value.trim().length > 0 && pickedIds.value.length > 0)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset()
      void loadLessons()
    }
  },
  { immediate: true },
)

function reset() {
  title.value = ''
  description.value = ''
  orderMode.value = 'free'
  authMode.value = 'name'
  pickedIds.value = []
}

async function loadLessons() {
  loadingLessons.value = true
  loadError.value = null
  try {
    allLessons.value = await fetchNormalizedLessons()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load lessons.'
    allLessons.value = []
  } finally {
    loadingLessons.value = false
  }
}

function addLesson(id: string) {
  if (!pickedIds.value.includes(id)) pickedIds.value = [...pickedIds.value, id]
}
function removeLesson(id: string) {
  pickedIds.value = pickedIds.value.filter((x) => x !== id)
}

// ── Drag-and-drop ordering of the picked set ──────────────────────────────
const dragIndex = ref<number | null>(null)
function onDragStart(i: number) {
  dragIndex.value = i
}
function onDrop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === target) return
  const next = [...pickedIds.value]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  pickedIds.value = next
}
function moveUp(i: number) {
  if (i <= 0) return
  const next = [...pickedIds.value]
  ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
  pickedIds.value = next
}
function moveDown(i: number) {
  if (i >= pickedIds.value.length - 1) return
  const next = [...pickedIds.value]
  ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
  pickedIds.value = next
}

function close() {
  emit('update:open', false)
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const { course } = await createCourse({
      title: title.value.trim(),
      description: description.value.trim(),
      orderMode: orderMode.value,
      authMode: authMode.value,
      lessonIds: pickedIds.value,
    })
    message.success('Course created as a draft')
    emit('created', course.id)
    close()
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not create the course.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="New course"
    width="640px"
    :confirm-loading="saving"
    :ok-button-props="{ disabled: !canSave }"
    ok-text="Save as draft"
    @update:open="(v: boolean) => emit('update:open', v)"
    @ok="save"
    @cancel="close"
  >
    <div class="flex flex-col gap-4">
      <!-- (a) title + description -->
      <div>
        <label class="mb-1 block text-sm font-semibold text-aha-space">Course title</label>
        <a-input
          v-model:value="title"
          placeholder="e.g. New-hire onboarding"
          data-testid="course-title"
          :maxlength="120"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm font-semibold text-aha-space">Description</label>
        <a-textarea
          v-model:value="description"
          placeholder="What will learners get out of this course?"
          :rows="2"
          :maxlength="500"
          data-testid="course-description"
        />
      </div>

      <!-- (b) pick lessons -->
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="text-sm font-semibold text-aha-space">Lessons in this course</label>
          <span class="text-xs text-aha-indigo">
            {{ pickedIds.length }} selected · ~{{ totalDuration }} min total
          </span>
        </div>

        <a-alert
          v-if="loadError"
          type="error"
          show-icon
          :message="loadError"
          class="mb-2 rounded-aha"
        />
        <a-spin v-else-if="loadingLessons" />

        <!-- Picked (ordered, draggable) -->
        <ul v-if="pickedIds.length" class="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          <li
            v-for="(l, i) in pickedLessons"
            :key="l.id"
            class="flex items-center gap-2 rounded-aha border border-aha-lavender bg-white px-3 py-2"
            draggable="true"
            data-testid="picked-lesson"
            @dragstart="onDragStart(i)"
            @dragover.prevent
            @drop="onDrop(i)"
          >
            <span class="cursor-grab text-aha-indigo" title="Drag to reorder">
              <HolderOutlined />
            </span>
            <span class="w-5 shrink-0 text-center text-xs font-bold text-aha-purple">{{ i + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-aha-space" :title="l.title">
              {{ l.title }}
            </span>
            <a-tag
              v-if="l.status !== 'published'"
              color="default"
              class="m-0 shrink-0 capitalize"
            >
              {{ l.status }}
            </a-tag>
            <span
              v-if="l.estimatedDurationMinutes"
              class="inline-flex shrink-0 items-center gap-1 text-xs text-aha-indigo"
            >
              <ClockCircleOutlined /> {{ l.estimatedDurationMinutes }}m
            </span>
            <span class="flex shrink-0 flex-col">
              <button
                class="reorder-up leading-none text-aha-indigo disabled:opacity-30"
                :disabled="i === 0"
                title="Move up"
                @click="moveUp(i)"
              >▲</button>
              <button
                class="reorder-down leading-none text-aha-indigo disabled:opacity-30"
                :disabled="i === pickedLessons.length - 1"
                title="Move down"
                @click="moveDown(i)"
              >▼</button>
            </span>
            <a-button
              type="text"
              size="small"
              danger
              class="inline-flex shrink-0 items-center justify-center"
              title="Remove"
              @click="removeLesson(l.id)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </li>
        </ul>

        <!-- Available to add -->
        <div v-if="!loadingLessons && !loadError">
          <p v-if="!allLessons.length" class="text-sm text-aha-indigo">
            You have no lessons yet — create a lesson first, then build a course from it.
          </p>
          <ul v-else-if="availableLessons.length" class="m-0 flex list-none flex-col gap-1 p-0">
            <li
              v-for="l in availableLessons"
              :key="l.id"
              class="flex items-center gap-2 rounded-aha bg-aha-blush px-3 py-2"
            >
              <span class="min-w-0 flex-1 truncate text-sm text-aha-space" :title="l.title">
                {{ l.title }}
              </span>
              <a-tag
                v-if="l.status !== 'published'"
                color="default"
                class="m-0 shrink-0 capitalize"
              >
                {{ l.status }}
              </a-tag>
              <a-button
                size="small"
                type="link"
                class="inline-flex shrink-0 items-center"
                data-testid="add-lesson"
                @click="addLesson(l.id)"
              >
                <template #icon><PlusOutlined /></template>
                Add
              </a-button>
            </li>
          </ul>
          <p v-else class="text-xs text-aha-indigo">All your lessons are in this course.</p>
        </div>
      </div>

      <!-- (c) order mode -->
      <div>
        <label class="mb-1 block text-sm font-semibold text-aha-space">Lesson order</label>
        <a-radio-group v-model:value="orderMode" data-testid="order-mode">
          <a-radio value="free">Free — learner picks any lesson</a-radio>
          <a-radio value="sequential">Sequential — unlock as previous complete</a-radio>
        </a-radio-group>
      </div>

      <!-- (d) auth mode -->
      <div>
        <label class="mb-1 block text-sm font-semibold text-aha-space">Who can take it</label>
        <a-radio-group v-model:value="authMode" data-testid="auth-mode">
          <a-radio value="anonymous">Anonymous</a-radio>
          <a-radio value="name">Ask for name</a-radio>
          <a-radio value="email">Ask for email</a-radio>
        </a-radio-group>
      </div>
    </div>
  </a-modal>
</template>
