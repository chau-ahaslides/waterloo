// Tests for the HTML slide-type module (WAT-3) — contract + player rendering
// (sanitized) + editor. The deep sanitizer assertions live in sanitize.test.ts.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import { htmlModule, HTML_TYPE, type HtmlLessonSlide } from './module'
import HtmlSlide from './HtmlSlide.vue'
import HtmlSlideEditor from './HtmlSlideEditor.vue'

describe('htmlModule', () => {
  it('is an authorable, info-only type', () => {
    expect(htmlModule.type).toBe(HTML_TYPE)
    expect(htmlModule.hasResponse).toBe(false)
    expect(htmlModule.authoring).toBe(true)
    expect(htmlModule.label).toBe('HTML')
    expect(htmlModule.createBlank!(3)).toEqual({ id: 3, type: HTML_TYPE, heading: '', html: '' })
  })

  it('never converts a presenter slide', () => {
    expect(htmlModule.convert({ id: 1, type: 'freestyle' } as never)).toBeNull()
  })
})

describe('HtmlSlide.vue', () => {
  it('renders sanitized HTML (script removed) and emits continue', async () => {
    const slide: HtmlLessonSlide = {
      id: 1,
      type: HTML_TYPE,
      heading: 'Doc',
      html: '<p>Hi</p><script>alert(1)</script>',
    }
    const wrapper = mount(HtmlSlide, { props: { slide }, global: { plugins: [Antd] } })
    expect(wrapper.html()).toContain('Hi')
    expect(wrapper.html()).not.toContain('alert(1)')
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Continue'))
    await btn!.trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })
})

describe('HtmlSlideEditor.vue', () => {
  it('emits update:slide when the HTML changes', async () => {
    const slide: HtmlLessonSlide = { id: 1, type: HTML_TYPE, heading: '', html: '' }
    const wrapper = mount(HtmlSlideEditor, { props: { slide }, global: { plugins: [Antd] } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('<p>new</p>')
    const emitted = wrapper.emitted('update:slide')
    expect((emitted!.at(-1)![0] as HtmlLessonSlide).html).toBe('<p>new</p>')
  })
})
