<script setup lang="ts">
/**
 * WAT-14 — Course detail / editor (/courses/c/:courseId).
 *
 *   (a) editable course title (inline),
 *   (b) member lessons list with per-lesson estimated duration + computed TOTAL
 *       course duration,
 *   (c) add / remove / reorder member lessons (native HTML5 drag + up/down),
 *   (d) Publish → mints a stable slug and exposes ahaslides.com/learn/c/[slug].
 *
 * One-course-per-lesson is enforced server-side (adding a lesson owned by another
 * course returns 409 → surfaced as an error message here).
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  ArrowLeftOutlined,
  HolderOutlined,
  DeleteOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  EditOutlined,
  BarChartOutlined,
} from '@ant-design/icons-vue'
import {
  fetchCourseDetail,
  patchCourse,
  addCourseLesson,
  removeCourseLesson,
  reorderCourse,
  publishCourse,
  unpublishCourse,
  fetchNormalizedLessons,
  type CourseDetail,
  type CourseMemberLesson,
  type NormalizedLesson,
  type OrderMode,
  type AuthMode,
} from '@/api/courses-api'

const route = useRoute()
const router = useRouter()
const courseId = route.params.courseId as string

const course = ref<CourseDetail | null>(null)
const members = ref<CourseMemberLesson[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const allLessons = ref<NormalizedLesson[]>([])

const titleDraft = ref('')
const editingTitle = ref(false)
const savingTitle = ref(false)
const publishing = ref(false)
const addOpen = ref(false)

const totalDuration = computed(() => course.value?.totalDurationMinutes ?? 0)
const isPublished = computed(() => course.value?.status === 'published')
const shareSlug = computed(() => course.value?.shareLinkSlug ?? null)
const shareUrlDisplay = computed(() =>
  shareSlug.value ? `ahaslides.com/learn/c/${shareSlug.value}` : '',
)
const shareUrlReal = computed(() =>
  shareSlug.value ? `${window.location.origin}/learn/c/${shareSlug.value}` : '',
)

const memberLessonIds = computed(() => new Set(members.value.map((m) => m.lessonId)))
const addableLessons = computed(() =>
  allLessons.value.filter((l) => !memberLessonIds.value.has(l.id)),
)

const publishedMemberCount = computed(
  () => members.value.filter((m) => m.status === 'published').length,
)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const data = await fetchCourseDetail(courseId)
    course.value = data.course
    members.value = data.lessons
    titleDraft.value = data.course.title
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load this course.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try {
    allLessons.value = await fetchNormalizedLessons()
  } catch {
    /* add-lesson list just stays empty */
  }
})

function apply(data: { course: CourseDetail; lessons: CourseMemberLesson[] }) {
  course.value = data.course
  members.value = data.lessons
}

// ── Title editing ─────────────────────────────────────────────────────────
function startEditTitle() {
  titleDraft.value = course.value?.title ?? ''
  editingTitle.value = true
}
async function saveTitle() {
  const t = titleDraft.value.trim()
  if (!t || t === course.value?.title) {
    editingTitle.value = false
    return
  }
  savingTitle.value = true
  try {
    apply(await patchCourse(courseId, { title: t }))
    editingTitle.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not save the title.')
  } finally {
    savingTitle.value = false
  }
}

// ── Order / auth mode ───────────────────────────────────────────────────────
async function setOrderMode(mode: OrderMode) {
  if (!course.value || course.value.orderMode === mode) return
  try {
    apply(await patchCourse(courseId, { orderMode: mode }))
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not update.')
  }
}
async function setAuthMode(mode: AuthMode) {
  if (!course.value || course.value.authMode === mode) return
  try {
    apply(await patchCourse(courseId, { authMode: mode }))
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not update.')
  }
}

// ── Add / remove ──────────────────────────────────────────────────────────
async function addLesson(lessonId: string) {
  try {
    apply(await addCourseLesson(courseId, lessonId))
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not add the lesson.')
  }
}
function confirmRemove(m: CourseMemberLesson) {
  Modal.confirm({
    title: 'Remove lesson from course?',
    content: `"${m.title}" will be removed from this course (the lesson itself is not deleted).`,
    okText: 'Remove',
    okType: 'danger',
    onOk: async () => {
      try {
        apply(await removeCourseLesson(courseId, m.lessonId))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Could not remove the lesson.')
      }
    },
  })
}

// ── Reorder (drag + up/down) ────────────────────────────────────────────────
const dragIndex = ref<number | null>(null)
function onDragStart(i: number) {
  dragIndex.value = i
}
function onDrop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === target) return
  move(from, target)
}
function move(from: number, to: number) {
  const next = [...members.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  members.value = next
  void persistOrder()
}
function moveUp(i: number) {
  if (i > 0) move(i, i - 1)
}
function moveDown(i: number) {
  if (i < members.value.length - 1) move(i, i + 1)
}
async function persistOrder() {
  try {
    apply(await reorderCourse(courseId, members.value.map((m) => m.lessonId)))
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Reorder failed.')
    await load()
  }
}

// ── Publish ───────────────────────────────────────────────────────────────
async function doPublish() {
  publishing.value = true
  try {
    apply(await publishCourse(courseId))
    message.success('Course published')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Publish failed.')
  } finally {
    publishing.value = false
  }
}
async function doUnpublish() {
  publishing.value = true
  try {
    apply(await unpublishCourse(courseId))
    message.success('Course taken offline')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not unpublish.')
  } finally {
    publishing.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrlReal.value)
    message.success('Link copied')
  } catch {
    message.info(shareUrlReal.value)
  }
}

function goBack() {
  router.push({ name: 'courses-home', query: route.query })
}
/** Open the owner-facing course progress dashboard (WAT-15). */
function openDashboard() {
  router.push({ name: 'course-dashboard', params: { courseId }, query: route.query })
}
function statusColor(status: string): string {
  return status === 'published' ? 'green' : status === 'unpublished' ? 'orange' : 'default'
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-10">
    <a-button type="text" class="mb-4 inline-flex items-center gap-1 px-0" @click="goBack">
      <ArrowLeftOutlined /> Back to courses
    </a-button>

    <a-alert
      v-if="loadError"
      type="error"
      show-icon
      message="Could not load course"
      :description="loadError"
      class="mb-4 rounded-aha"
    >
      <template #action>
        <a-button size="small" type="primary" @click="load">Retry</a-button>
      </template>
    </a-alert>

    <a-skeleton v-else-if="loading" active :paragraph="{ rows: 4 }" />

    <template v-else-if="course">
      <!-- Header: editable title + status + publish -->
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div v-if="!editingTitle" class="flex items-center gap-2">
            <h1 class="m-0 min-w-0 truncate text-2xl font-extrabold text-aha-space" :title="course.title">
              {{ course.title }}
            </h1>
            <a-button
              type="text"
              size="small"
              class="inline-flex shrink-0 items-center justify-center"
              title="Edit title"
              data-testid="edit-title"
              @click="startEditTitle"
            >
              <template #icon><EditOutlined /></template>
            </a-button>
            <a-tag :color="statusColor(course.status)" class="m-0 shrink-0 capitalize">{{ course.status }}</a-tag>
          </div>
          <div v-else class="flex items-center gap-2">
            <a-input
              v-model:value="titleDraft"
              data-testid="title-input"
              :maxlength="120"
              @press-enter="saveTitle"
            />
            <a-button type="primary" :loading="savingTitle" data-testid="save-title" @click="saveTitle">
              Save
            </a-button>
            <a-button @click="editingTitle = false">Cancel</a-button>
          </div>
          <p v-if="course.description" class="mt-2 text-sm text-aha-indigo">{{ course.description }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-aha-indigo">
            <span class="inline-flex items-center gap-1">
              {{ members.length }} lesson{{ members.length === 1 ? '' : 's' }}
            </span>
            <span class="inline-flex items-center gap-1" data-testid="total-duration">
              <ClockCircleOutlined /> ~{{ totalDuration }} min total
            </span>
          </div>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-2">
          <a-button
            v-if="!isPublished"
            type="primary"
            :loading="publishing"
            data-testid="publish-btn"
            @click="doPublish"
          >
            Publish
          </a-button>
          <a-button v-else :loading="publishing" data-testid="unpublish-btn" @click="doUnpublish">
            Take offline
          </a-button>
          <a-button
            class="flex items-center"
            data-testid="course-dashboard-btn"
            @click="openDashboard"
          >
            <template #icon><BarChartOutlined /></template>
            Dashboard
          </a-button>
        </div>
      </header>

      <!-- Share link (when published) -->
      <a-alert
        v-if="isPublished && shareSlug"
        type="success"
        show-icon
        class="mb-6 rounded-aha"
        data-testid="share-link"
      >
        <template #message>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">Live at</span>
            <code class="rounded bg-white px-2 py-1 text-aha-purple">{{ shareUrlDisplay }}</code>
            <a-button size="small" @click="copyLink">Copy link</a-button>
            <a :href="shareUrlReal" target="_blank" rel="noopener" class="text-aha-purple underline">
              Open
            </a>
          </div>
        </template>
      </a-alert>

      <!-- Settings: order + auth mode -->
      <section class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-aha border border-aha-lavender p-4">
          <p class="mb-2 text-sm font-semibold text-aha-space">Lesson order</p>
          <a-radio-group :value="course.orderMode" data-testid="order-mode" @update:value="setOrderMode">
            <a-radio value="free">Free</a-radio>
            <a-radio value="sequential">Sequential</a-radio>
          </a-radio-group>
        </div>
        <div class="rounded-aha border border-aha-lavender p-4">
          <p class="mb-2 text-sm font-semibold text-aha-space">Who can take it</p>
          <a-radio-group :value="course.authMode" data-testid="auth-mode" @update:value="setAuthMode">
            <a-radio value="anonymous">Anonymous</a-radio>
            <a-radio value="name">Name</a-radio>
            <a-radio value="email">Email</a-radio>
          </a-radio-group>
        </div>
      </section>

      <!-- Member lessons -->
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="m-0 text-lg font-bold text-aha-space">Lessons</h2>
          <a-button class="inline-flex items-center" data-testid="open-add" @click="addOpen = !addOpen">
            <template #icon><PlusOutlined /></template>
            Add lesson
          </a-button>
        </div>

        <p
          v-if="isPublished && publishedMemberCount < members.length"
          class="mb-3 text-xs text-aha-indigo"
        >
          Only published lessons appear in the live course. Publish a lesson, then re-publish
          the course to include it.
        </p>

        <ul v-if="members.length" class="m-0 flex list-none flex-col gap-2 p-0">
          <li
            v-for="(m, i) in members"
            :key="m.lessonId"
            class="flex items-center gap-2 rounded-aha border border-aha-lavender bg-white px-3 py-2"
            draggable="true"
            data-testid="member-lesson"
            @dragstart="onDragStart(i)"
            @dragover.prevent
            @drop="onDrop(i)"
          >
            <span class="cursor-grab text-aha-indigo" title="Drag to reorder">
              <HolderOutlined />
            </span>
            <span class="w-5 shrink-0 text-center text-xs font-bold text-aha-purple">{{ i + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-aha-space" :title="m.title">{{ m.title }}</span>
            <a-tag :color="statusColor(m.status)" class="m-0 shrink-0 capitalize">{{ m.status }}</a-tag>
            <span
              v-if="m.estimatedDurationMinutes"
              class="inline-flex shrink-0 items-center gap-1 text-xs text-aha-indigo"
            >
              <ClockCircleOutlined /> {{ m.estimatedDurationMinutes }}m
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
                :disabled="i === members.length - 1"
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
              data-testid="remove-lesson"
              @click="confirmRemove(m)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </li>
        </ul>
        <p v-else class="text-sm text-aha-indigo">
          No lessons yet. Add at least one published lesson, then publish the course.
        </p>

        <!-- Add-lesson panel -->
        <div v-if="addOpen" class="mt-3 rounded-aha bg-aha-blush p-3" data-testid="add-panel">
          <p v-if="!addableLessons.length" class="m-0 text-sm text-aha-indigo">
            No more lessons available to add (lessons already in another course are excluded).
          </p>
          <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
            <li
              v-for="l in addableLessons"
              :key="l.id"
              class="flex items-center gap-2 rounded-aha bg-white px-3 py-2"
            >
              <span class="min-w-0 flex-1 truncate text-sm text-aha-space" :title="l.title">{{ l.title }}</span>
              <a-tag :color="statusColor(l.status)" class="m-0 shrink-0 capitalize">{{ l.status }}</a-tag>
              <a-button
                size="small"
                type="link"
                class="inline-flex shrink-0 items-center"
                data-testid="add-candidate"
                @click="addLesson(l.id)"
              >
                <template #icon><CheckOutlined /></template>
                Add
              </a-button>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </main>
</template>
