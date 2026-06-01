<script setup lang="ts">
// LessonEditor.vue — the lesson editor (route /lessons/:id/edit). WAT-3 v1.
//
// Two-pane layout:
//   - LEFT: lesson metadata (title, description) + a reorderable slide outline
//           (move up/down, remove) + an "add slide" palette (authorable types).
//   - RIGHT: the per-slide authoring form for the selected slide, rendered via
//            the registry's `editorComponent` for that slide's type.
//
// Persistence is D1 via src/api/lessons-api.ts: the editor loads a lesson, the
// trainer edits it, Save writes a draft, Publish flips status → published.
// The editor is slide-type-agnostic — it never references a concrete type; the
// palette + forms come entirely from the slide-type registry.

import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { type Lesson, type LessonSlide } from '@/lessons/lessons'
import { fetchLesson, publishLesson, saveLesson } from '@/api/lessons-api'
import {
  createBlankSlide,
  getAuthorableModules,
  getEditorComponent,
  getTypeLabel,
} from '@/slide-types/registry'

const route = useRoute()
const router = useRouter()
const lessonId = route.params.id as string

const lesson = ref<Lesson | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const saving = ref(false)
const publishing = ref(false)
const selectedIndex = ref(0)
/** Tracks unsaved edits since the last successful save. */
const dirty = ref(false)

onMounted(async () => {
  try {
    lesson.value = await fetchLesson(lessonId)
    if (!lesson.value) loadError.value = 'Lesson not found.'
  } catch (e) {
    loadError.value =
      e instanceof Error ? e.message : 'Could not load this lesson.'
  } finally {
    loading.value = false
  }
})

// ── Palette of authorable slide types (from the registry) ───────────────────────
const palette = computed(() =>
  getAuthorableModules().map((m) => ({
    type: m.type,
    label: getTypeLabel(m.type),
  })),
)

const slides = computed<LessonSlide[]>(() => lesson.value?.slides ?? [])
const selectedSlide = computed<LessonSlide | null>(
  () => slides.value[selectedIndex.value] ?? null,
)
const selectedEditor = computed(() =>
  selectedSlide.value ? getEditorComponent(selectedSlide.value.type) : undefined,
)

/** A short, human label for a slide row in the outline. */
function slideLabel(s: LessonSlide): string {
  const anyS = s as unknown as Record<string, unknown>
  const text =
    (typeof anyS.question === 'string' && anyS.question) ||
    (typeof anyS.heading === 'string' && anyS.heading) ||
    (typeof anyS.title === 'string' && anyS.title) ||
    ''
  return (text as string).trim() || `Untitled ${getTypeLabel(s.type)}`
}

function markDirty() {
  dirty.value = true
}

function selectSlide(i: number) {
  selectedIndex.value = i
}

/** The selected slide's editor emitted an update — replace it in the array. */
function onSlideUpdate(updated: LessonSlide) {
  if (!lesson.value) return
  const next = [...lesson.value.slides]
  next[selectedIndex.value] = updated
  lesson.value = { ...lesson.value, slides: next }
  markDirty()
}

/** Next slide id — max existing + 1 (ids are local to the lesson). */
function nextSlideId(): number {
  return slides.value.reduce((max, s) => Math.max(max, s.id), 0) + 1
}

function addSlide(type: string) {
  if (!lesson.value) return
  const slide = createBlankSlide(type, nextSlideId())
  if (!slide) return
  const next = [...lesson.value.slides, slide as LessonSlide]
  lesson.value = { ...lesson.value, slides: next }
  selectedIndex.value = next.length - 1
  markDirty()
}

function removeSlide(i: number) {
  if (!lesson.value) return
  const next = lesson.value.slides.filter((_, idx) => idx !== i)
  lesson.value = { ...lesson.value, slides: next }
  if (selectedIndex.value >= next.length) {
    selectedIndex.value = Math.max(0, next.length - 1)
  }
  markDirty()
}

function moveSlide(i: number, dir: -1 | 1) {
  if (!lesson.value) return
  const j = i + dir
  if (j < 0 || j >= slides.value.length) return
  const next = [...lesson.value.slides]
  ;[next[i], next[j]] = [next[j], next[i]]
  lesson.value = { ...lesson.value, slides: next }
  selectedIndex.value = j
  markDirty()
}

function updateMeta(part: Partial<Pick<Lesson, 'title' | 'description'>>) {
  if (!lesson.value) return
  lesson.value = { ...lesson.value, ...part }
  markDirty()
}

async function doSave(): Promise<boolean> {
  if (!lesson.value) return false
  saving.value = true
  try {
    const saved = await saveLesson({
      id: lesson.value.id,
      presentationId: lesson.value.presentationId,
      title: lesson.value.title,
      description: lesson.value.description,
      slides: lesson.value.slides,
    })
    lesson.value = saved
    dirty.value = false
    message.success('Draft saved')
    return true
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not save the lesson.')
    return false
  } finally {
    saving.value = false
  }
}

async function doPublish() {
  if (!lesson.value) return
  publishing.value = true
  try {
    // Save any pending edits first so the published version is current.
    if (dirty.value) {
      const ok = await doSave()
      if (!ok) return
    }
    const published = await publishLesson(lesson.value.id)
    lesson.value = published
    message.success('Lesson published')
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Could not publish.')
  } finally {
    publishing.value = false
  }
}

function goHome() {
  router.push({ name: 'home', query: route.query })
}

function preview() {
  router.push({ name: 'lesson-play', params: { id: lessonId }, query: route.query })
}
</script>

<template>
  <!-- ── Loading ────────────────────────────────────────────────────────────── -->
  <main
    v-if="loading"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <div class="text-5xl text-aha-purple"><LoadingOutlined spin /></div>
    <h1 class="text-xl font-extrabold text-aha-space">Loading editor…</h1>
  </main>

  <!-- ── Load error / not found ─────────────────────────────────────────────── -->
  <main
    v-else-if="loadError || !lesson"
    class="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-aha-blush px-6 text-center"
  >
    <h1 class="text-2xl font-extrabold text-aha-space">Can’t open this lesson</h1>
    <p class="text-aha-indigo">{{ loadError ?? 'Lesson not found.' }}</p>
    <a-button type="primary" @click="goHome">
      <template #icon><ArrowLeftOutlined /></template>
      Back to My Lessons
    </a-button>
  </main>

  <!-- ── Editor ─────────────────────────────────────────────────────────────── -->
  <main v-else class="flex min-h-[100dvh] w-full flex-col bg-aha-blush">
    <!-- Top bar -->
    <header
      class="flex w-full flex-wrap items-center gap-3 border-b border-aha-indigo/10 bg-white px-6 py-3 shadow-aha-sm"
    >
      <a-button type="text" class="shrink-0 inline-flex items-center" @click="goHome">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-bold text-aha-space" :title="lesson.title">
          {{ lesson.title || 'Untitled lesson' }}
        </p>
        <p class="text-xs text-aha-indigo">
          <a-tag
            :color="lesson.status === 'published' ? 'green' : 'default'"
            class="m-0 mr-2 capitalize"
          >{{ lesson.status }}</a-tag>
          <span v-if="dirty" class="text-aha-carmine">Unsaved changes</span>
          <span v-else>All changes saved</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <a-button class="inline-flex items-center" @click="preview">
          <template #icon><PlayCircleOutlined /></template>
          Preview
        </a-button>
        <a-button
          class="inline-flex items-center"
          :loading="saving"
          @click="doSave"
        >
          <template #icon><SaveOutlined /></template>
          Save draft
        </a-button>
        <a-button
          type="primary"
          class="inline-flex items-center"
          :loading="publishing"
          @click="doPublish"
        >
          <template #icon><CloudUploadOutlined /></template>
          {{ lesson.status === 'published' ? 'Re-publish' : 'Publish' }}
        </a-button>
      </div>
    </header>

    <!-- Two-pane body -->
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6 lg:flex-row">
      <!-- LEFT: metadata + outline -->
      <aside class="w-full shrink-0 lg:w-80">
        <section class="mb-5 rounded-aha border-2 border-aha-indigo/10 bg-white p-4 shadow-aha-sm">
          <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-aha-purple">
            Lesson details
          </h2>
          <label class="mb-1 block text-sm font-semibold text-aha-space">Title</label>
          <a-input
            :value="lesson.title"
            placeholder="Lesson title"
            :maxlength="200"
            class="mb-3 rounded-aha"
            @update:value="(v: string) => updateMeta({ title: v })"
          />
          <label class="mb-1 block text-sm font-semibold text-aha-space">Description</label>
          <a-textarea
            :value="lesson.description"
            placeholder="What is this lesson about?"
            :auto-size="{ minRows: 2, maxRows: 5 }"
            class="rounded-aha"
            @update:value="(v: string) => updateMeta({ description: v })"
          />
        </section>

        <section class="rounded-aha border-2 border-aha-indigo/10 bg-white p-4 shadow-aha-sm">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-bold uppercase tracking-wide text-aha-purple">
              Slides ({{ slides.length }})
            </h2>
          </div>

          <ol v-if="slides.length" class="mb-4 flex flex-col gap-2">
            <li
              v-for="(s, i) in slides"
              :key="s.id"
              class="flex items-center gap-2 rounded-aha border-2 px-2 py-2 transition-colors"
              :class="i === selectedIndex
                ? 'border-aha-purple bg-aha-lavender/20'
                : 'border-aha-indigo/10 bg-white hover:border-aha-purple/40'"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                @click="selectSlide(i)"
              >
                <span
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aha-lavender/50 text-xs font-bold text-aha-purple"
                >{{ i + 1 }}</span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-aha-space">
                    {{ slideLabel(s) }}
                  </span>
                  <span class="block text-xs text-aha-indigo">{{ getTypeLabel(s.type) }}</span>
                </span>
              </button>
              <div class="flex shrink-0 flex-col">
                <a-button
                  type="text"
                  size="small"
                  class="!h-5 inline-flex items-center justify-center"
                  :disabled="i === 0"
                  @click="moveSlide(i, -1)"
                >
                  <template #icon><ArrowUpOutlined /></template>
                </a-button>
                <a-button
                  type="text"
                  size="small"
                  class="!h-5 inline-flex items-center justify-center"
                  :disabled="i === slides.length - 1"
                  @click="moveSlide(i, 1)"
                >
                  <template #icon><ArrowDownOutlined /></template>
                </a-button>
              </div>
              <a-popconfirm
                title="Remove this slide?"
                ok-text="Remove"
                cancel-text="Cancel"
                @confirm="removeSlide(i)"
              >
                <a-button
                  type="text"
                  danger
                  size="small"
                  class="inline-flex items-center justify-center"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-popconfirm>
            </li>
          </ol>
          <a-empty
            v-else
            description="No slides yet — add one below"
            class="my-4"
          />

          <div class="border-t border-aha-indigo/10 pt-3">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-aha-indigo">
              Add slide
            </p>
            <div class="flex flex-wrap gap-2">
              <a-button
                v-for="p in palette"
                :key="p.type"
                size="small"
                class="inline-flex items-center"
                @click="addSlide(p.type)"
              >
                <template #icon><PlusOutlined /></template>
                {{ p.label }}
              </a-button>
            </div>
          </div>
        </section>
      </aside>

      <!-- RIGHT: per-slide editor form -->
      <section class="min-w-0 flex-1 rounded-aha border-2 border-aha-indigo/10 bg-white p-6 shadow-aha-sm">
        <template v-if="selectedSlide">
          <div class="mb-4 flex items-center gap-2">
            <span
              class="inline-flex items-center rounded-full bg-aha-lavender/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-aha-purple"
            >{{ getTypeLabel(selectedSlide.type) }}</span>
            <span class="text-sm text-aha-indigo">Slide {{ selectedIndex + 1 }}</span>
          </div>
          <component
            :is="selectedEditor"
            v-if="selectedEditor"
            :key="selectedSlide.id"
            :slide="selectedSlide"
            @update:slide="onSlideUpdate"
          />
          <a-alert
            v-else
            type="info"
            show-icon
            message="This slide type isn’t editable yet"
            description="It will still play in the lesson, but has no authoring form."
            class="rounded-aha"
          />
        </template>
        <div
          v-else
          class="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center text-aha-indigo"
        >
          <CheckCircleOutlined class="text-4xl text-aha-purple/40" />
          <p class="m-0">Add a slide from the palette, then edit it here.</p>
        </div>
      </section>
    </div>
  </main>
</template>
