// Pick-answer slide-type module — the FIRST module implementing the
// SlideTypeModule contract. It owns:
//   - the lesson-slide shape for a multiple-choice question,
//   - converting a raw presenter `pickAnswer` slide into that shape,
//   - the response type (selected option id) + score contribution,
//   - the render+response component (PickAnswerSlide.vue).
//
// The recognition logic (which `pickAnswer` slideType variants carry options)
// stays in src/api/slides.ts as `isPickAnswerSlide`, so this module reuses it.

import { isPickAnswerSlide, type RawSlide, type RawSlideOption } from '@/api/slides'
import type { BaseLessonSlide, SlideTypeModule } from '../types'
import PickAnswerSlide from './PickAnswerSlide.vue'
import PickAnswerEditor from './PickAnswerEditor.vue'

/** The discriminator key for this type. */
export const PICK_ANSWER_TYPE = 'pickAnswer' as const

/** One answer option of a pick-answer lesson slide. */
export interface PickAnswerOption {
  id: number
  text: string
  isCorrect: boolean
  image?: string | null
}

/** A multiple-choice "pick answer" lesson slide. */
export interface PickAnswerLessonSlide extends BaseLessonSlide {
  type: typeof PICK_ANSWER_TYPE
  question: string
  options: PickAnswerOption[]
}

/** The response captured by the component: the selected option id. */
export type PickAnswerResponse = number

/** Map a raw "pick answer" presenter slide into a pick-answer lesson slide. */
function convert(raw: RawSlide): PickAnswerLessonSlide | null {
  if (!isPickAnswerSlide(raw)) return null
  const options = (raw.SlideOptions ?? []).map(
    (o: RawSlideOption): PickAnswerOption => ({
      id: o.id,
      text: (o.title ?? '').trim(),
      isCorrect: Boolean(o.correct),
      image: o.image ?? null,
    }),
  )
  return {
    id: raw.id,
    type: PICK_ANSWER_TYPE,
    question: (raw.title ?? '').trim() || 'Untitled question',
    options,
  }
}

export const pickAnswerModule: SlideTypeModule<
  PickAnswerLessonSlide,
  PickAnswerResponse
> = {
  type: PICK_ANSWER_TYPE,
  hasResponse: true,
  label: 'Quiz',
  authoring: true,
  convert,
  component: PickAnswerSlide,
  editorComponent: PickAnswerEditor,
  createBlank(id) {
    return {
      id,
      type: PICK_ANSWER_TYPE,
      question: '',
      options: [
        { id: 1, text: '', isCorrect: true },
        { id: 2, text: '', isCorrect: false },
      ],
    }
  },
  scoreFor(slide, response) {
    const opt = slide.options.find((o) => o.id === response)
    return opt?.isCorrect ? 1 : 0
  },
  snapshotFor(slide, response) {
    const opt = slide.options.find((o) => o.id === response) ?? null
    return {
      question: slide.question,
      // Store the chosen option's text (human-readable) plus its id for
      // unambiguous aggregation in the report.
      response: { optionId: response, text: opt?.text ?? '(no answer)' },
      correct: opt ? opt.isCorrect : null,
    }
  },
}
