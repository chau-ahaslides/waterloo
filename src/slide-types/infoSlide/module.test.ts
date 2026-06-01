// Info-slide module tests — INDEPENDENT of the player and other slide types.
// Covers convert logic (freestyle → info card, HTML→text, blank-skip), the
// info-only contract flags, and a component mount that emits `continue`.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { RawSlide } from '@/api/slides'
import { infoSlideModule, INFO_SLIDE_TYPE, type InfoLessonSlide } from './module'
import InfoSlide from './InfoSlide.vue'

const rawFreestyle: RawSlide = {
  id: 100,
  type: 'freestyle',
  slideType: null,
  title: 'Historic Landmarks',
  order: 1,
  subheading: 'Hanoi highlights',
  bodyHTML: '<p>Hoan Kiem Lake</p><p>Old Quarter</p>',
}

describe('infoSlideModule — contract', () => {
  it('declares its type and that it captures NO response (info-only)', () => {
    expect(infoSlideModule.type).toBe(INFO_SLIDE_TYPE)
    expect(infoSlideModule.hasResponse).toBe(false)
    expect(infoSlideModule.scoreFor).toBeUndefined()
  })
})

describe('infoSlideModule.convert', () => {
  it('converts a freestyle slide into an info lesson slide', () => {
    const slide = infoSlideModule.convert(rawFreestyle)
    expect(slide).not.toBeNull()
    expect(slide!.type).toBe('infoSlide')
    expect(slide!.title).toBe('Historic Landmarks')
    expect(slide!.subheading).toBe('Hanoi highlights')
  })

  it('strips HTML from bodyHTML into plain text with line breaks', () => {
    const slide = infoSlideModule.convert(rawFreestyle)!
    expect(slide.body).toContain('Hoan Kiem Lake')
    expect(slide.body).toContain('Old Quarter')
    expect(slide.body).not.toContain('<p>')
  })

  it('returns null for a blank freestyle slide (no title/body/image)', () => {
    const slide = infoSlideModule.convert({
      id: 1,
      type: 'freestyle',
      slideType: null,
      title: '',
      order: 1,
    })
    expect(slide).toBeNull()
  })

  it('returns null for a non-freestyle slide', () => {
    const slide = infoSlideModule.convert({
      id: 2,
      type: 'pickAnswer',
      slideType: null,
      title: 'Q?',
      order: 1,
    })
    expect(slide).toBeNull()
  })

  it('falls back to sanitizedTitle when title is empty', () => {
    const slide = infoSlideModule.convert({
      id: 3,
      type: 'freestyle',
      slideType: null,
      title: '',
      sanitizedTitle: 'Culinary Delights',
      order: 1,
    })
    expect(slide!.title).toBe('Culinary Delights')
  })
})

describe('InfoSlide.vue — component', () => {
  const slide: InfoLessonSlide = infoSlideModule.convert(rawFreestyle)!

  it('renders the title, subheading and body', () => {
    const wrapper = mount(InfoSlide, {
      props: { slide, showingFeedback: false, response: null },
      global: { plugins: [Antd] },
    })
    const text = wrapper.text()
    expect(text).toContain('Historic Landmarks')
    expect(text).toContain('Hanoi highlights')
    expect(text).toContain('Hoan Kiem Lake')
    expect(text).toContain('Continue')
  })

  it('emits `continue` when the Continue button is tapped', async () => {
    const wrapper = mount(InfoSlide, {
      props: { slide, showingFeedback: false, response: null },
      global: { plugins: [Antd] },
    })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Continue'))
    await btn!.trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })
})
