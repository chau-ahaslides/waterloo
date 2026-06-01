// HTML sanitizer for the authorable HTML slide type (WAT-3).
//
// Trainers paste raw HTML; we render it with v-html, so it MUST be sanitized to
// prevent XSS. This is a deliberately conservative, dependency-free, string-
// based allowlist sanitizer suited to the lightweight rich content an HTML
// content block needs (headings, paragraphs, lists, links, images, basic
// formatting, tables). It runs in BOTH the browser and SSR/tests (no DOM
// dependency), so the player renders identical output everywhere.
//
// Strategy:
//   1. Remove dangerous *elements* whole (script/style/iframe/object/etc.),
//      including their contents.
//   2. For surviving tags, drop any attribute that is not on the allowlist,
//      and drop event-handler attributes (on*) + javascript:/data: URLs.
//   3. Drop tags not on the element allowlist entirely (keep their text).

/** Block-removed elements: dropped WITH their inner content. */
const FORBIDDEN_ELEMENTS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'template',
  'noscript',
]

/** Tags whose markup is kept (others are unwrapped — content kept, tag dropped). */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul',
])

/** Attributes allowed on any surviving tag. */
const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class', 'target', 'rel',
])

/** URL-bearing attributes whose value must be a safe scheme. */
const URL_ATTRS = new Set(['href', 'src'])

/** Reject a URL with a dangerous scheme (javascript:, data:, vbscript:). */
function isUnsafeUrl(value: string): boolean {
  // Strip whitespace + control chars (incl. tabs/newlines used to obfuscate
  // schemes like "java\tscript:") and numeric HTML entities, then scheme-test.
  const v = value
    .toLowerCase()
    .replace(/&#x?[0-9a-f]+;?/g, '')
    .replace(/[\u0000-\u0020]+/g, '')
  return /^(javascript|data|vbscript):/i.test(v)
}

/** Sanitize the attributes of a single opening tag, returning safe attrs text. */
function sanitizeAttrs(rawAttrs: string): string {
  const out: string[] = []
  // Match  name="..."  | name='...'  | name=bare  | name (boolean)
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[4] ?? m[5] ?? m[6] ?? ''
    // Drop event handlers and any non-allowlisted attribute.
    if (name.startsWith('on')) continue
    if (!ALLOWED_ATTRS.has(name)) continue
    if (URL_ATTRS.has(name) && isUnsafeUrl(value)) continue
    if (m[2] === undefined) {
      out.push(name) // boolean attribute
    } else {
      out.push(`${name}="${value.replace(/"/g, '&quot;')}"`)
    }
  }
  return out.join(' ')
}

/**
 * Sanitize a raw HTML string into a safe subset for rendering with v-html.
 * Pure string transform — no DOM, safe in browser, SSR and tests.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return ''
  let html = input

  // 1. Strip forbidden elements WITH their content (incl. unclosed at EOF).
  for (const tag of FORBIDDEN_ELEMENTS) {
    const withContent = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
    html = html.replace(withContent, '')
    // Self-closing / orphan opening tags of forbidden elements.
    const orphan = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
    html = html.replace(orphan, '')
  }

  // 2. Strip HTML comments (can hide conditional-comment script in old IE).
  html = html.replace(/<!--[\s\S]*?-->/g, '')

  // 3. Walk every remaining tag: allowlist the element, sanitize its attrs,
  //    or unwrap a disallowed tag (drop the tag, keep its text).
  html = html.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\s*(\/?)>/g,
    (_full, closing: string, name: string, attrs: string, selfClose: string) => {
      const tag = name.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return '' // unwrap unknown tag
      if (closing) return `</${tag}>`
      const safeAttrs = sanitizeAttrs(attrs)
      const sc = selfClose ? ' /' : ''
      return safeAttrs ? `<${tag} ${safeAttrs}${sc}>` : `<${tag}${sc}>`
    },
  )

  return html
}
