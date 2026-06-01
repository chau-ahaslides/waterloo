// Pick-answer slide-type module tests — INDEPENDENT of the player and other
// types (point #3 of the directive). Covers convert logic, scoring, the
// contract flags, and a component mount that exercises response reception.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import type { RawSlide } from '@/api/slides'
import {
  pickAnswerModule,
  PICK_ANSWER_TYPE,
  type PickAnswerLessonSlide,
} from './module'
import PickAnswerSlide from './PickAnswerSlide.vue'

const rawPickAnswer: RawSlide = {
  id: 1,
  type: 'pickAnswer',
  slideType: null,
  title: 'What is 2+2?',
  order: 1,
  SlideOptions: [
    { id: 10, title: '3', correct: false, order: 1 },
    { id: 11, title: '4', correct: true, order: 2 },
  ],
}

describe('pickAnswerModule — contract', () => {
  it('declares its type and that it captures a response', () => {
    expect(pickAnswerModule.type).toBe(PICK_ANSWER_TYPE)
    expect(pickAnswerModule.hasResponse).toBe(true)
  })
})

describe('pickAnswerModule.convert', () => {
  it('converts a raw pickAnswer slide into a lesson slide', () => {
    const slide = pickAnswerModule.convert(rawPickAnswer)
    expect(slide).not.toBeNull()
    expect(slide!.type).toBe('pickAnswer')
    expect(slide!.question).toBe('What is 2+2?')
    expect(slide!.options).toHaveLength(2)
    expect(slide!.options.find((o) => o.isCorrect)?.text).toBe('4')
  })

  it('falls back to "Untitled question" on empty title', () => {
    const slide = pickAnswerModule.convert({ ...rawPickAnswer, title: '' })
    expect(slide!.question).toBe('Untitled question')
  })

  it('returns null for the typeAnswer variant (no options)', () => {
    const slide = pickAnswerModule.convert({
      ...rawPickAnswer,
      slideType: 'typeAnswer',
      SlideOptions: [],
    })
    expect(slide).toBeNull()
  })

  it('returns null for a non-pickAnswer slide', () => {
    const slide = pickAnswerModule.convert({
      id: 2,
      type: 'wordCloud',
      slideType: null,
      title: 'x',
      order: 1,
    })
    expect(slide).toBeNull()
  })
})

describe('pickAnswerModule.scoreFor', () => {
  const slide = pickAnswerModule.convert(rawPickAnswer)!
  it('scores 1 for the correct option id', () => {
    expect(pickAnswerModule.scoreFor!(slide, 11)).toBe(1)
  })
  it('scores 0 for a wrong option id', () => {
    expect(pickAnswerModule.scoreFor!(slide, 10)).toBe(0)
  })
  it('scores 0 for an unknown option id', () => {
    expect(pickAnswerModule.scoreFor!(slide, 999)).toBe(0)
  })
})

describe('PickAnswerSlide.vue — component', () => {
  const slide: PickAnswerLessonSlide = pickAnswerModule.convert(rawPickAnswer)!

  function mountSlide(props: Partial<Record<string, unknown>> = {}) {
    return mount(PickAnswerSlide, {
      props: { slide, showingFeedback: false, response: null, ...props },
      global: { plugins: [Antd] },
    })
  }

  it('renders the question and all options', () => {
    const wrapper = mountSlide()
    const text = wrapper.text()
    expect(text).toContain('What is 2+2?')
    expect(text).toContain('3')
    expect(text).toContain('4')
  })

  it('emits `answered` with the option id when tapped', async () => {
    const wrapper = mountSlide()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('4'))
    await btn!.trigger('click')
    expect(wrapper.emitted('answered')).toBeTruthy()
    expect(wrapper.emitted('answered')![0]).toEqual([11])
  })

  it('does not emit a second answer while feedback is showing (guard)', async () => {
    const wrapper = mountSlide({ showingFeedback: true, response: 11 })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('3'))
    await btn!.trigger('click')
    expect(wrapper.emitted('answered')).toBeFalsy()
  })

  it('shows the Correct! banner when the chosen option is correct', () => {
    const wrapper = mountSlide({ showingFeedback: true, response: 11 })
    expect(wrapper.text()).toContain('Correct!')
  })

  it('shows the not-quite banner when the chosen option is wrong', () => {
    const wrapper = mountSlide({ showingFeedback: true, response: 10 })
    expect(wrapper.text()).toContain('Not quite')
  })
})
