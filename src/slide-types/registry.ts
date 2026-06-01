// Slide-type registry — the single place that knows the set of supported slide
// types. The generic player, converter and ConverterModal talk ONLY to this
// module + the contract in types.ts; they never import a concrete slide type.
//
// To add a new slide type: create `src/slide-types/<name>/` (module + component
// + tests) and add its module to SLIDE_TYPE_MODULES below. Nothing else changes.

import type { Component } from 'vue'
import type { RawSlide } from '@/api/slides'
import type { AnyLessonSlide, SlideTypeModule } from './types'
import { pickAnswerModule } from './pickAnswer/module'
import { infoSlideModule } from './infoSlide/module'

/**
 * Every registered slide-type module, in CONVERSION-PRIORITY order. When
 * converting a raw presenter slide the registry tries each module's `convert`
 * and the first non-null result wins, so order matters only if two modules
 * could claim the same raw slide (they don't today).
 */
export const SLIDE_TYPE_MODULES: ReadonlyArray<
  SlideTypeModule<AnyLessonSlide, unknown>
> = [
  pickAnswerModule as unknown as SlideTypeModule<AnyLessonSlide, unknown>,
  infoSlideModule as unknown as SlideTypeModule<AnyLessonSlide, unknown>,
]

const BY_TYPE = new Map(SLIDE_TYPE_MODULES.map((m) => [m.type, m]))

/** Look up the module that owns a given lesson-slide `type`, or undefined. */
export function getSlideTypeModule(
  type: string,
): SlideTypeModule<AnyLessonSlide, unknown> | undefined {
  return BY_TYPE.get(type)
}

/** The render+response component for a lesson-slide `type`, or undefined. */
export function getSlideComponent(type: string): Component | undefined {
  return BY_TYPE.get(type)?.component
}

/**
 * Convert ONE raw presenter slide via the first registered module that claims
 * it. Returns null when no module matches (the slide is skipped, as today).
 */
export function convertRawSlide(raw: RawSlide): AnyLessonSlide | null {
  for (const mod of SLIDE_TYPE_MODULES) {
    const slide = mod.convert(raw)
    if (slide) return slide
  }
  return null
}

/**
 * Whether a lesson-slide type captures a response (vs. info-only). Unknown
 * types default to false (treated as info-only / advance-on-click) so an
 * orphaned slide can never wedge the player.
 */
export function typeHasResponse(type: string): boolean {
  return BY_TYPE.get(type)?.hasResponse ?? false
}

/** Score a captured response for a lesson slide via its module (0 if none). */
export function scoreForSlide(slide: AnyLessonSlide, response: unknown): number {
  const mod = BY_TYPE.get(slide.type)
  if (!mod?.scoreFor) return 0
  return mod.scoreFor(slide, response)
}
