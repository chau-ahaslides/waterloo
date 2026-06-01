// Tests for the HTML sanitizer (WAT-3) — the XSS-prevention boundary for the
// authorable HTML slide type. These are the security-critical assertions.

import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('keeps allowlisted formatting tags', () => {
    const out = sanitizeHtml('<p>Hello <strong>world</strong></p><ul><li>a</li></ul>')
    expect(out).toContain('<p>')
    expect(out).toContain('<strong>')
    expect(out).toContain('<li>')
  })

  it('removes <script> elements and their content', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<p>ok</p>')
  })

  it('strips inline event-handler attributes', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">')
    expect(out).not.toMatch(/onerror/i)
    expect(out).toContain('<img')
  })

  it('drops javascript: URLs on href/src', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toMatch(/javascript:/i)
  })

  it('strips style + iframe + object elements entirely', () => {
    const out = sanitizeHtml(
      '<style>body{}</style><iframe src="evil"></iframe><object data="x"></object><p>safe</p>',
    )
    expect(out).not.toMatch(/iframe|object|style/i)
    expect(out).toContain('<p>safe</p>')
  })

  it('unwraps unknown tags but keeps their text', () => {
    const out = sanitizeHtml('<marquee>scroll</marquee>')
    expect(out).not.toMatch(/marquee/i)
    expect(out).toContain('scroll')
  })

  it('keeps safe links + images with allowed attrs', () => {
    const out = sanitizeHtml('<a href="https://x.com" title="t">link</a><img src="https://x.com/a.png" alt="a">')
    expect(out).toContain('href="https://x.com"')
    expect(out).toContain('src="https://x.com/a.png"')
    expect(out).toContain('alt="a"')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('')
  })

  it('neutralises obfuscated javascript: schemes', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>')
    expect(out).not.toMatch(/alert/i)
  })
})
