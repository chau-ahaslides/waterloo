// YouTube slide-type module (WAT-3) — an AUTHORABLE, info-only embedded-video
// block. A trainer pastes a YouTube URL (watch?v=, youtu.be/, /embed/, /shorts/)
// or a bare 11-char video id; the player renders the embedded iframe player.
//
// We store the raw input the trainer typed (`url`) and derive the canonical
// video id at render time via `parseYouTubeId`, so paste-anything works and the
// stored value stays human-meaningful. Info-only (`hasResponse: false`),
// authored from scratch (`convert` returns null).

import type { RawSlide } from '@/api/slides'
import type { BaseLessonSlide, SlideTypeModule } from '../types'
import YoutubeSlide from './YoutubeSlide.vue'
import YoutubeSlideEditor from './YoutubeSlideEditor.vue'

/** The discriminator key for this type. */
export const YOUTUBE_TYPE = 'youtube' as const

/** An authorable YouTube-video content lesson slide. */
export interface YoutubeLessonSlide extends BaseLessonSlide {
  type: typeof YOUTUBE_TYPE
  /** Optional heading shown above the player. */
  heading?: string
  /** The trainer's raw input — a YouTube URL or a bare video id. */
  url: string
}

/**
 * Extract the canonical 11-char YouTube video id from a URL or bare id, or null
 * if none is recognised. Handles watch?v=, youtu.be/, /embed/, /shorts/,
 * /live/, and a bare id; ignores extra query params (timestamps, playlists).
 */
export function parseYouTubeId(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null

  // Bare 11-char id (the YouTube id alphabet).
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const isYt =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be'
  if (!isYt) return null

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0]
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  }

  // youtube.com/watch?v=<id>
  const v = url.searchParams.get('v')
  if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const m = url.pathname.match(/\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/)
  if (m) return m[2]

  return null
}

/** Build the privacy-friendly embed URL for a video id. */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`
}

export const youtubeModule: SlideTypeModule<YoutubeLessonSlide, never> = {
  type: YOUTUBE_TYPE,
  hasResponse: false,
  label: 'YouTube',
  authoring: true,
  convert(_raw: RawSlide): YoutubeLessonSlide | null {
    return null
  },
  component: YoutubeSlide,
  editorComponent: YoutubeSlideEditor,
  createBlank(id: number): YoutubeLessonSlide {
    return { id, type: YOUTUBE_TYPE, heading: '', url: '' }
  },
}
