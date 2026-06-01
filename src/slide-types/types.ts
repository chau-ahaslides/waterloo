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

  // ── Authoring surface (WAT-3) ─────────────────────────────────────────────
  // The fields below power the lesson editor. They are OPTIONAL so a module can
  // be playback-only (converted-but-not-authorable, like the converter-only
  // `infoSlide`). A module is "authorable" when it sets `authoring: true` and
  // provides `createBlank` + `editorComponent`. The editor never references a
  // concrete type — it lists authorable modules from the registry and renders
  // each slide's `editorComponent`.

  /**
   * Human-readable label for this type (shown in the editor's "add slide"
   * palette and the slide-outline rows). Defaults to `type` when omitted.
   */
  readonly label?: string

  /**
   * Whether a trainer can CREATE a blank slide of this type from the editor's
   * palette. Converted-only types (e.g. `infoSlide`, which only ever comes from
   * the converter) leave this false/undefined and are still fully editable if
   * they supply an `editorComponent`, just not creatable from scratch.
   */
  readonly authoring?: boolean

  /**
   * Build a fresh, valid-enough blank slide of this type with the given id.
   * Only meaningful when `authoring` is true. The editor calls this when the
   * trainer adds a slide of this type from the palette.
   */
  createBlank?(id: number): TSlide

  /**
   * The Vue component that renders this type's AUTHORING form in the editor's
   * right pane. Contract for its props + emits:
   *   props:  { slide: TSlide }
   *   emits:  `update:slide` (payload: the edited TSlide) — the editor stores it.
   * A module without an `editorComponent` is not editable (the editor shows a
   * read-only notice for such slides).
   */
  readonly editorComponent?: Component

  /**
   * Score contribution for a captured response: 1 for correct, 0 otherwise.
   * Only meaningful when `hasResponse` is true; info-only modules may omit it
   * (the player never calls it for them).
   */
  scoreFor?(slide: TSlide, response: TResponse): number

  /**
   * Build a self-contained, report-friendly snapshot of a captured response.
   * The audience-submission page stores this per response-bearing slide so the
   * report renders from the persisted data alone (the lesson definition lives
   * only in the creator's localStorage). Only meaningful when `hasResponse` is
   * true. Modules may omit it; the registry falls back to a generic snapshot.
   *   - `question`: a human-readable prompt/title snapshot.
   *   - `response`: a display-friendly description of what the audience picked.
   *   - `correct`:  whether the response was correct, or null if N/A.
   */
  snapshotFor?(
    slide: TSlide,
    response: TResponse,
  ): { question: string; response: unknown; correct: boolean | null }
}

/**
 * A lesson slide of any registered type. The generic player + converter type
 * slides as this; the per-type component narrows to its concrete shape via its
 * `slide` prop. (It is just BaseLessonSlide — modules extend it with their own
 * payload, and every concrete slide is assignable here.)
 */
export type AnyLessonSlide = BaseLessonSlide
