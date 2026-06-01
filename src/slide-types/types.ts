// Slide-type contract — the pluggable architecture core.
//
// A lesson is a sequence of slides. Each slide has a `type` discriminator that
// names a registered SlideTypeModule. A module is FULLY self-contained: it owns
//   - how a raw presenter slide is recognised + converted into its lesson shape,
//   - the Vue component that RENDERS it in the audience/preview view AND handles
//     its own response reception (option buttons, feedback, "continue", …),
//   - whether it captures a response at all (`hasResponse`) and, if so, how a
//     given response contributes to the score (`scoreFor`).
//
// Adding a new slide type in the future means: create `src/slide-types/<name>/`
// (module + component + tests) and register it in `registry.ts`. NOTHING in the
// generic player (LessonPlay.vue), converter (lessons.ts) or ConverterModal.vue
// needs to change — they only ever talk to the registry + this contract.

import type { Component } from 'vue'
import type { RawSlide } from '@/api/slides'

/**
 * The shared envelope every lesson slide carries. Per-type modules extend this
 * with their own payload (e.g. pick-answer adds `question` + `options`).
 *
 * `type` is the discriminator — it MUST equal the owning module's `type` key so
 * the registry can route the slide back to the module that produced it.
 */
export interface BaseLessonSlide {
  /** Stable id (the source presenter slide id). */
  id: number
  /** The registered slide-type key, e.g. 'pickAnswer' | 'infoSlide'. */
  type: string
}

/**
 * The contract every slide-type module implements.
 *
 * `TSlide` is the module's concrete lesson-slide shape (a BaseLessonSlide
 * subtype). `TResponse` is whatever the component emits when the learner
 * responds — `void`/`never` for info-only types.
 */
export interface SlideTypeModule<
  TSlide extends BaseLessonSlide = BaseLessonSlide,
  TResponse = unknown,
> {
  /** Unique discriminator key. Matches `BaseLessonSlide.type`. */
  readonly type: string

  /**
   * Whether this slide type captures a learner response.
   *   - true  → the component emits `answered` (payload = TResponse) and the
   *             player auto-advances after brief feedback; counts toward score.
   *   - false → INFO-ONLY: the component shows content + emits `continue`; the
   *             player advances on click; never counts toward score.
   */
  readonly hasResponse: boolean

  /**
   * Convert a raw presenter slide into this module's lesson slide, or return
   * null if the raw slide is not this type. The registry tries each module's
   * `convert` in order; the first non-null wins. A module that returns null for
   * everything it doesn't own keeps the converter generic.
   */
  convert(raw: RawSlide): TSlide | null

  /**
   * The Vue component that renders this slide in the audience/preview view AND
   * receives its own response. Contract for the component's props + emits:
   *   props:  { slide: TSlide; showingFeedback: boolean; response: TResponse | null }
   *   emits:  response types → `answered` (payload: TResponse)
   *           info-only types → `continue` (no payload)
   */
  readonly component: Component

  /**
   * Score contribution for a captured response: 1 for correct, 0 otherwise.
   * Only meaningful when `hasResponse` is true; info-only modules may omit it
   * (the player never calls it for them).
   */
  scoreFor?(slide: TSlide, response: TResponse): number
}

/**
 * A lesson slide of any registered type. The generic player + converter type
 * slides as this; the per-type component narrows to its concrete shape via its
 * `slide` prop. (It is just BaseLessonSlide — modules extend it with their own
 * payload, and every concrete slide is assignable here.)
 */
export type AnyLessonSlide = BaseLessonSlide
