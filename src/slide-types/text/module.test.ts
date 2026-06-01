// Tests for the Text slide-type module (WAT-3) — module contract + editor +
// player component, independent of the rest of the app (per WAT-7 policy).

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import { textModule, TEXT_TYPE, type TextLessonSlide } from './module'
import TextSlide from './TextSlide.vue'
import TextSlideEditor from './TextSlideEditor.vue'

describe('textModule', () => {
  it('is an authorable, info-only type', () => {
    expect(textModule.type).toBe(TEXT_TYPE)
    expect(textModule.hasResponse).toBe(false)
    expect(textModule.authoring).toBe(true)
    expect(textModule.label).toBe('Text')
    expect(typeof textModule.createBlank).toBe('function')
    expect(textModule.editorComponent).toBeTruthy()
  })

  it('never converts a presenter slide (authored only)', () => {
    expect(textModule.convert({ id: 1, type: 'freestyle' } as never)).toBeNull()
  })

  it('createBlank produces an empty text slide with the given id', () => {
    const s = textModule.createBlank!(7)
    expect(s).toEqual({ id: 7, type: TEXT_TYPE, heading: '', body: '' })
  })
})

describe('TextSlide.vue', () => {
  it('renders heading + body and emits continue', async () => {
    const slide: TextLessonSlide = { id: 1, type: TEXT_TYPE, heading: 'Intro', body: 'Hello\nWorld' }
    const wrapper = mount(TextSlide, { props: { slide }, global: { plugins: [Antd] } })
    expect(wrapper.text()).toContain('Intro')
    expect(wrapper.text()).toContain('Hello')
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Continue'))
    await btn!.trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })
})

describe('TextSlideEditor.vue', () => {
  it('emits update:slide when the body changes', async () => {
    const slide: TextLessonSlide = { id: 1, type: TEXT_TYPE, heading: '', body: '' }
    const wrapper = mount(TextSlideEditor, { props: { slide }, global: { plugins: [Antd] } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('New body')
    const emitted = wrapper.emitted('update:slide')
    expect(emitted).toBeTruthy()
    expect((emitted!.at(-1)![0] as TextLessonSlide).body).toBe('New body')
  })
})
