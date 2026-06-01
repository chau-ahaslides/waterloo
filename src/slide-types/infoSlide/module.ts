// Info-slide module — a SECOND module implementing the SlideTypeModule
// contract, deliberately INFO-ONLY (`hasResponse: false`) to prove point #2 of
// the directive: a slide type that purely shows content and captures no
// response. It maps an AhaSlides `freestyle` (heading/content) presenter slide
// into a titled content card.
//
// `freestyle` is the real AhaSlides content/heading slide type (confirmed
// 2026-06-01 against GET /api/presentation/detail — e.g. the "Discover Hanoi"
// deck has freestyle slides with `title` + optional `subheading`/`bodyHTML`/
// `image`). A freestyle slide with NO title, body or image is blank filler and
// returns null (skipped), so the lesson never shows an empty card.

import type { RawSlide } from '@/api/slides'
import type { BaseLessonSlide, SlideTypeModule } from '../types'
import InfoSlide from './InfoSlide.vue'
import InfoSlideEditor from './InfoSlideEditor.vue'

/** The discriminator key for this type. */
export const INFO_SLIDE_TYPE = 'infoSlide' as const

/** An info-only content lesson slide (no response captured). */
export interface InfoLessonSlide extends BaseLessonSlide {
  type: typeof INFO_SLIDE_TYPE
  title: string
  subheading?: string
  /** Plain-text body (HTML stripped from the source `bodyHTML`). */
  body?: string
  image?: string | null
}

/** Raw presenter slide types treated as info-only content slides. */
const INFO_PRESENTER_TYPES: ReadonlyArray<string> = ['freestyle']

/** Strip HTML tags + collapse whitespace into plain display text. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function convert(raw: RawSlide): InfoLessonSlide | null {
  if (!INFO_PRESENTER_TYPES.includes(raw.type)) return null

  const title = str(raw.title) || str((raw as Record<string, unknown>).sanitizedTitle)
  const subheading = str((raw as Record<string, unknown>).subheading)
  const bodyHTML = str((raw as Record<string, unknown>).bodyHTML)
  const description = str((raw as Record<string, unknown>).description)
  const body = bodyHTML ? htmlToText(bodyHTML) : description
  const image = str((raw as Record<string, unknown>).image) || null

  // Skip blank filler slides — nothing to show ⇒ not a useful lesson slide.
  if (!title && !subheading && !body && !image) return null

  return {
    id: raw.id,
    type: INFO_SLIDE_TYPE,
    title: title || 'Information',
    ...(subheading ? { subheading } : {}),
    ...(body ? { body } : {}),
    ...(image ? { image } : {}),
  }
}

export const infoSlideModule: SlideTypeModule<InfoLessonSlide, never> = {
  type: INFO_SLIDE_TYPE,
  hasResponse: false,
  label: 'Info',
  // Converter-only: comes from a presenter `freestyle` slide, not the palette.
  // Still editable in the editor via `editorComponent`.
  authoring: false,
  convert,
  component: InfoSlide,
  editorComponent: InfoSlideEditor,
}
