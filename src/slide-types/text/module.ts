// Text slide-type module (WAT-3) — an AUTHORABLE, info-only content block.
//
// A Text slide carries an optional heading + a plain/lightly-formatted text
// body that a trainer types in the editor. It captures NO response
// (`hasResponse: false`). Unlike `infoSlide` (converter-only, derived from a
// presenter `freestyle` slide), Text is created from scratch in the editor —
// it sets `authoring: true`, supplies `createBlank`, and an `editorComponent`.
//
// It has no `convert` source today (trainers add it manually), so `convert`
// always returns null — the converter never produces a Text slide.

import type { RawSlide } from '@/api/slides'
import type { BaseLessonSlide, SlideTypeModule } from '../types'
import TextSlide from './TextSlide.vue'
import TextSlideEditor from './TextSlideEditor.vue'

/** The discriminator key for this type. */
export const TEXT_TYPE = 'text' as const

/** An authorable plain-text content lesson slide (no response captured). */
export interface TextLessonSlide extends BaseLessonSlide {
  type: typeof TEXT_TYPE
  /** Optional heading shown above the body. */
  heading?: string
  /** Plain/lightly-formatted text body (rendered with line breaks preserved). */
  body: string
}

export const textModule: SlideTypeModule<TextLessonSlide, never> = {
  type: TEXT_TYPE,
  hasResponse: false,
  label: 'Text',
  authoring: true,
  // Text slides are authored, never converted from a presenter slide.
  convert(_raw: RawSlide): TextLessonSlide | null {
    return null
  },
  component: TextSlide,
  editorComponent: TextSlideEditor,
  createBlank(id: number): TextLessonSlide {
    return { id, type: TEXT_TYPE, heading: '', body: '' }
  },
}
