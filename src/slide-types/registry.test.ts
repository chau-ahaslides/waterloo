// Registry tests — the generic routing layer. Asserts lookup, conversion
// priority, response/score delegation and the unknown-type fallbacks.

import { describe, it, expect } from 'vitest'
import type { RawSlide } from '@/api/slides'
import {
  SLIDE_TYPE_MODULES,
  getSlideTypeModule,
  getSlideComponent,
  convertRawSlide,
  typeHasResponse,
  scoreForSlide,
  snapshotForSlide,
} from './registry'

describe('registry — registration', () => {
  it('registers pickAnswer and infoSlide', () => {
    const types = SLIDE_TYPE_MODULES.map((m) => m.type)
    expect(types).toContain('pickAnswer')
    expect(types).toContain('infoSlide')
  })

  it('looks up a module + component by type', () => {
    expect(getSlideTypeModule('pickAnswer')?.type).toBe('pickAnswer')
    expect(getSlideComponent('pickAnswer')).toBeTruthy()
    expect(getSlideTypeModule('nope')).toBeUndefined()
    expect(getSlideComponent('nope')).toBeUndefined()
  })
})

describe('registry — convertRawSlide', () => {
  it('routes a pickAnswer raw slide to the pick-answer module', () => {
    const raw: RawSlide = {
      id: 1,
      type: 'pickAnswer',
      slideType: null,
      title: 'Q?',
      order: 1,
      SlideOptions: [{ id: 5, title: 'A', correct: true, order: 1 }],
    }
    const slide = convertRawSlide(raw)
    expect(slide?.type).toBe('pickAnswer')
  })

  it('routes a freestyle raw slide to the info module', () => {
    const raw: RawSlide = {
      id: 2,
      type: 'freestyle',
      slideType: null,
      title: 'Intro',
      order: 1,
    }
    expect(convertRawSlide(raw)?.type).toBe('infoSlide')
  })

  it('returns null for an unsupported raw slide type', () => {
    const raw: RawSlide = { id: 3, type: 'wordCloud', slideType: null, title: 'x', order: 1 }
    expect(convertRawSlide(raw)).toBeNull()
  })
})

describe('registry — response + scoring delegation', () => {
  it('typeHasResponse reflects each module, false for unknown types', () => {
    expect(typeHasResponse('pickAnswer')).toBe(true)
    expect(typeHasResponse('infoSlide')).toBe(false)
    expect(typeHasResponse('unknown')).toBe(false)
  })

  it('scoreForSlide delegates to the module (1 correct, 0 otherwise)', () => {
    const slide = convertRawSlide({
      id: 1,
      type: 'pickAnswer',
      slideType: null,
      title: 'Q?',
      order: 1,
      SlideOptions: [
        { id: 5, title: 'A', correct: true, order: 1 },
        { id: 6, title: 'B', correct: false, order: 2 },
      ],
    })!
    expect(scoreForSlide(slide, 5)).toBe(1)
    expect(scoreForSlide(slide, 6)).toBe(0)
  })

  it('scoreForSlide returns 0 for an info slide (no scoreFor)', () => {
    const info = convertRawSlide({
      id: 2,
      type: 'freestyle',
      slideType: null,
      title: 'Intro',
      order: 1,
    })!
    expect(scoreForSlide(info, null)).toBe(0)
  })
})

describe('registry — snapshotForSlide', () => {
  it('delegates to the pickAnswer module: question + chosen text + correctness', () => {
    const slide = convertRawSlide({
      id: 7,
      type: 'pickAnswer',
      slideType: null,
      title: 'Capital of France?',
      order: 1,
      SlideOptions: [
        { id: 5, title: 'Paris', correct: true, order: 1 },
        { id: 6, title: 'Berlin', correct: false, order: 2 },
      ],
    })!
    const correct = snapshotForSlide(slide, 5)
    expect(correct.question).toBe('Capital of France?')
    expect(correct.correct).toBe(true)
    expect(correct.response).toMatchObject({ optionId: 5, text: 'Paris' })

    const wrong = snapshotForSlide(slide, 6)
    expect(wrong.correct).toBe(false)
    expect(wrong.response).toMatchObject({ optionId: 6, text: 'Berlin' })
  })

  it('falls back generically for a type without snapshotFor (correct=null)', () => {
    const info = convertRawSlide({
      id: 8,
      type: 'freestyle',
      slideType: null,
      title: 'Intro',
      order: 1,
    })!
    const snap = snapshotForSlide(info, null)
    // Info slide has no scoreFor ⇒ correctness is null; title used as question.
    expect(snap.correct).toBeNull()
    expect(snap.question).toBe('Intro')
  })
})
