// Tests for the pick-answer authoring form (WAT-3). The quiz is FORMATIVE only,
// so the editor edits question + options + correctness, but exposes no scoring.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import PickAnswerEditor from './PickAnswerEditor.vue'
import { pickAnswerModule, type PickAnswerLessonSlide } from './module'

function blank(): PickAnswerLessonSlide {
  return pickAnswerModule.createBlank!(1) as PickAnswerLessonSlide
}

describe('PickAnswerEditor.vue', () => {
  it('createBlank seeds a question with 2 options (first correct)', () => {
    const s = blank()
    expect(s.options).toHaveLength(2)
    expect(s.options[0].isCorrect).toBe(true)
  })

  it('editing the question emits an updated slide', async () => {
    const wrapper = mount(PickAnswerEditor, { props: { slide: blank() }, global: { plugins: [Antd] } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('What is 2+2?')
    const emitted = wrapper.emitted('update:slide')
    expect((emitted!.at(-1)![0] as PickAnswerLessonSlide).question).toBe('What is 2+2?')
  })

  it('adding an option emits a slide with one more option', async () => {
    const wrapper = mount(PickAnswerEditor, { props: { slide: blank() }, global: { plugins: [Antd] } })
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add option'))
    await addBtn!.trigger('click')
    const emitted = wrapper.emitted('update:slide')
    expect((emitted!.at(-1)![0] as PickAnswerLessonSlide).options).toHaveLength(3)
  })

  it('mentions it is a formative quiz (no scoring)', () => {
    const wrapper = mount(PickAnswerEditor, { props: { slide: blank() }, global: { plugins: [Antd] } })
    expect(wrapper.text()).toContain('Formative quiz')
  })
})
