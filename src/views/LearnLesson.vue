<script setup lang="ts">
/**
 * WAT-12 — PUBLIC learner landing for a published lesson (/learn/:slug).
 *
 * This is the slug-resolution + not-available surface only; the real learner
 * PLAYER is Stage 5 (WAT-13). It works for anyone — no AhaSlides account, no
 * token — because it only fetches the PUBLISHED snapshot by slug.
 *
 * States:
 *   - loading       → spinner.
 *   - available     → "published" landing (title + slide count + Start placeholder).
 *   - not available → unknown / draft / unpublished slug → friendly offline page.
 */
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircleOutlined, FrownOutlined } from '@ant-design/icons-vue'
import { fetchPublishedBySlug, type PublishedLesson } from '@/api/courses-api'

const route = useRoute()
const slug = route.params.slug as string

const loading = ref(true)
const available = ref(false)
const lesson = ref<PublishedLesson | null>(null)
const notAvailableMessage = ref('This lesson is not available.')

onMounted(async () => {
  try {
    const result = await fetchPublishedBySlug(slug)
    if (result.available) {
      available.value = true
      lesson.value = result.lesson
    } else {
      available.value = false
      notAvailableMessage.value = result.error
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12">
    <!-- Loading -->
    <div v-if="loading" class="w-full">
      <a-skeleton active :paragraph="{ rows: 2 }" />
    </div>

    <!-- Available → published landing -->
    <a-card
      v-else-if="available && lesson"
      class="learn-available w-full rounded-aha text-center shadow-aha-sm"
    >
      <CheckCircleOutlined class="mb-3 text-4xl text-aha-teal" />
      <h1 class="mb-2 text-2xl font-extrabold text-aha-space">{{ lesson.title || 'Untitled lesson' }}</h1>
      <p class="mb-4 text-sm text-aha-indigo">
        {{ lesson.slides.filter((s) => s.type === 'question').length }} questions ·
        self-paced
      </p>
      <a-tag color="green" class="mb-4">Published</a-tag>
      <div>
        <a-button type="primary" size="large" disabled class="start-btn">
          Start lesson
        </a-button>
        <p class="mt-2 text-xs text-aha-indigo">The learner player arrives in the next release.</p>
      </div>
    </a-card>

    <!-- Not available -->
    <a-card v-else class="learn-unavailable w-full rounded-aha text-center shadow-aha-sm">
      <FrownOutlined class="mb-3 text-4xl text-aha-indigo" />
      <h1 class="mb-2 text-2xl font-extrabold text-aha-space">Lesson not available</h1>
      <p class="text-sm text-aha-indigo">{{ notAvailableMessage }}</p>
    </a-card>
  </main>
</template>
