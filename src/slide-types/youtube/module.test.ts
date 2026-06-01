// Tests for the YouTube slide-type module (WAT-3) — id parsing (the tricky
// bit), contract, player + editor.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Antd from 'ant-design-vue'
import {
  youtubeModule,
  YOUTUBE_TYPE,
  parseYouTubeId,
  youtubeEmbedUrl,
  type YoutubeLessonSlide,
} from './module'
import YoutubeSlide from './YoutubeSlide.vue'
import YoutubeSlideEditor from './YoutubeSlideEditor.vue'

describe('parseYouTubeId', () => {
  it('parses watch?v= URLs (ignoring extra params)', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe('dQw4w9WgXcQ')
  })
  it('parses youtu.be short links', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses /embed/ and /shorts/ URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('accepts a bare 11-char id', () => {
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube or invalid input', () => {
    expect(parseYouTubeId('https://vimeo.com/123')).toBeNull()
    expect(parseYouTubeId('not a url')).toBeNull()
    expect(parseYouTubeId('')).toBeNull()
  })
  it('builds a privacy-friendly embed URL', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })
})

describe('youtubeModule', () => {
  it('is an authorable, info-only type', () => {
    expect(youtubeModule.type).toBe(YOUTUBE_TYPE)
    expect(youtubeModule.hasResponse).toBe(false)
    expect(youtubeModule.authoring).toBe(true)
    expect(youtubeModule.label).toBe('YouTube')
    expect(youtubeModule.createBlank!(2)).toEqual({ id: 2, type: YOUTUBE_TYPE, heading: '', url: '' })
  })
})

describe('YoutubeSlide.vue', () => {
  it('renders an iframe for a valid url and emits continue', async () => {
    const slide: YoutubeLessonSlide = {
      id: 1,
      type: YOUTUBE_TYPE,
      heading: 'Watch',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    }
    const wrapper = mount(YoutubeSlide, { props: { slide }, global: { plugins: [Antd] } })
    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('src')).toContain('dQw4w9WgXcQ')
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Continue'))
    await btn!.trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })

  it('shows a notice (no iframe) for an invalid url', () => {
    const slide: YoutubeLessonSlide = { id: 1, type: YOUTUBE_TYPE, url: 'nope' }
    const wrapper = mount(YoutubeSlide, { props: { slide }, global: { plugins: [Antd] } })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('No valid YouTube video')
  })
})

describe('YoutubeSlideEditor.vue', () => {
  it('emits update:slide and confirms a recognised id', async () => {
    const slide: YoutubeLessonSlide = { id: 1, type: YOUTUBE_TYPE, url: '' }
    const wrapper = mount(YoutubeSlideEditor, { props: { slide }, global: { plugins: [Antd] } })
    // The URL field is the second input (heading is first).
    const inputs = wrapper.findAll('input')
    await inputs[inputs.length - 1].setValue('https://youtu.be/dQw4w9WgXcQ')
    const emitted = wrapper.emitted('update:slide')
    expect((emitted!.at(-1)![0] as YoutubeLessonSlide).url).toBe('https://youtu.be/dQw4w9WgXcQ')
  })
})
