<script setup lang="ts">
// PickAnswerEditor.vue — authoring form for a pick-answer (quiz) slide. Edits
// the question, options (add/remove/edit text), and which option(s) are correct.
// Quiz is FORMATIVE only (WAT-3): no points/pass-threshold — correctness drives
// immediate feedback in the player, nothing else. Multi-correct is allowed (the
// model already supports it). Emits `update:slide` on every change.

import {
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons-vue'
import type { PickAnswerLessonSlide, PickAnswerOption } from './module'

const props = defineProps<{ slide: PickAnswerLessonSlide }>()
const emit = defineEmits<{
  (e: 'update:slide', slide: PickAnswerLessonSlide): void
}>()

function patch(part: Partial<PickAnswerLessonSlide>) {
  emit('update:slide', { ...props.slide, ...part })
}

/** Next option id — max existing + 1 (ids are local to the slide). */
function nextOptionId(): number {
  return props.slide.options.reduce((max, o) => Math.max(max, o.id), 0) + 1
}

function updateOption(id: number, part: Partial<PickAnswerOption>) {
  patch({
    options: props.slide.options.map((o) =>
      o.id === id ? { ...o, ...part } : o,
    ),
  })
}

function addOption() {
  patch({
    options: [
      ...props.slide.options,
      { id: nextOptionId(), text: '', isCorrect: false },
    ],
  })
}

function removeOption(id: number) {
  patch({ options: props.slide.options.filter((o) => o.id !== id) })
}

function toggleCorrect(id: number, checked: boolean) {
  updateOption(id, { isCorrect: checked })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <label class="mb-1 block text-sm font-semibold text-aha-space">Question</label>
      <a-textarea
        :value="slide.question"
        placeholder="Type the question…"
        :auto-size="{ minRows: 2, maxRows: 5 }"
        class="rounded-aha"
        @update:value="(v: string) => patch({ question: v })"
      />
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <label class="text-sm font-semibold text-aha-space">Answer options</label>
        <span class="text-xs text-aha-indigo">Tick the correct answer(s)</span>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="(opt, i) in slide.options"
          :key="opt.id"
          class="flex items-center gap-2 rounded-aha border-2 px-3 py-2"
          :class="opt.isCorrect ? 'border-aha-teal bg-aha-teal/5' : 'border-aha-indigo/15 bg-white'"
        >
          <a-checkbox
            :checked="opt.isCorrect"
            @update:checked="(c: boolean) => toggleCorrect(opt.id, c)"
          />
          <span class="w-5 shrink-0 text-center text-xs font-bold text-aha-indigo">
            {{ String.fromCharCode(65 + i) }}
          </span>
          <a-input
            :value="opt.text"
            :placeholder="`Option ${String.fromCharCode(65 + i)}`"
            class="flex-1 rounded-aha"
            @update:value="(v: string) => updateOption(opt.id, { text: v })"
          />
          <a-button
            type="text"
            danger
            size="small"
            class="inline-flex items-center justify-center"
            :disabled="slide.options.length <= 1"
            @click="removeOption(opt.id)"
          >
            <template #icon><DeleteOutlined /></template>
          </a-button>
        </div>
      </div>
      <a-button size="small" class="mt-2 inline-flex items-center" @click="addOption">
        <template #icon><PlusOutlined /></template>
        Add option
      </a-button>
    </div>

    <a-alert
      type="info"
      show-icon
      message="Formative quiz"
      description="Learners get immediate correct/incorrect feedback. No points or pass score — this quiz is for learning, not grading."
      class="rounded-aha"
    />
  </div>
</template>
