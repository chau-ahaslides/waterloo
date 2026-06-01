// HTML slide-type module (WAT-3) — an AUTHORABLE, info-only rich-content block.
//
// A trainer pastes raw HTML in the editor; the player renders it (via v-html)
// AFTER sanitizing to a safe subset (see sanitize.ts) to prevent XSS. The
// stored value is the trainer's raw HTML; sanitization happens at render time
// so the editor preview and the player share one source of truth and the
// allowlist can evolve without a data migration.
//
// Info-only (`hasResponse: false`); authored from scratch (no converter source,
// so `convert` returns null).

import type { RawSlide } from '@/api/slides'
import type { BaseLessonSlide, SlideTypeModule } from '../types'
import HtmlSlide from './HtmlSlide.vue'
import HtmlSlideEditor from './HtmlSlideEditor.vue'

/** The discriminator key for this type. */
export const HTML_TYPE = 'html' as const

/** An authorable raw-HTML content lesson slide (sanitized on render). */
export interface HtmlLessonSlide extends BaseLessonSlide {
  type: typeof HTML_TYPE
  /** Optional heading shown above the rendered HTML. */
  heading?: string
  /** Raw HTML authored by the trainer (sanitized at render time). */
  html: string
}

export const htmlModule: SlideTypeModule<HtmlLessonSlide, never> = {
  type: HTML_TYPE,
  hasResponse: false,
  label: 'HTML',
  authoring: true,
  convert(_raw: RawSlide): HtmlLessonSlide | null {
    return null
  },
  component: HtmlSlide,
  editorComponent: HtmlSlideEditor,
  createBlank(id: number): HtmlLessonSlide {
    return { id, type: HTML_TYPE, heading: '', html: '' }
  },
}
