// Brand token catalogue — the single source for on-palette HEX values that
// code needs to embed inline (e.g. swatch arrays for colour pickers, dynamic
// style bindings). Mirrors the AhaSlides brand-colour spec v1.0 and matches
// the `aha-*` Tailwind tokens in tailwind.config.js. Consume tokens from this
// module (or the Tailwind class equivalents) rather than inlining raw HEX.

export const ahaBrand = {
  pink: '#FF4081',
  purple: '#6A1EBB',
  space: '#1A1A2E',
  white: '#FFFFFF',
  carmine: '#E6005C',
  darkPurple: '#5A189A',
  indigo: '#3E3E5A',
  sky: '#F0F4FF',
  coral: '#FF9068',
  teal: '#20E8B5',
  mint: '#B4E4E0',
  lavender: '#D3B4FF',
  rose: '#FAF0F6',
  blush: '#FDF6FA',
} as const

export type AhaBrandToken = keyof typeof ahaBrand

// Curated palette presets — every entry is composed exclusively of brand
// tokens, so swatch pickers stay on-palette by construction.
export const ahaPalettes = {
  vibrant: [
    ahaBrand.pink,
    ahaBrand.purple,
    ahaBrand.teal,
    ahaBrand.coral,
    ahaBrand.carmine,
    ahaBrand.darkPurple,
    ahaBrand.lavender,
  ],
  pastel: [
    ahaBrand.lavender,
    ahaBrand.mint,
    ahaBrand.sky,
    ahaBrand.rose,
    ahaBrand.blush,
  ],
  warm: [ahaBrand.coral, ahaBrand.pink, ahaBrand.carmine, ahaBrand.purple],
  cool: [
    ahaBrand.teal,
    ahaBrand.purple,
    ahaBrand.lavender,
    ahaBrand.mint,
    ahaBrand.sky,
    ahaBrand.darkPurple,
    ahaBrand.indigo,
  ],
  monochrome: [
    ahaBrand.blush,
    ahaBrand.rose,
    ahaBrand.lavender,
    ahaBrand.darkPurple,
    ahaBrand.indigo,
    ahaBrand.space,
  ],
} as const

export type AhaPaletteKey = keyof typeof ahaPalettes
