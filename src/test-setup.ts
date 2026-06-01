// Vitest jsdom setup for the "unit" project.
//
// jsdom does not implement window.matchMedia, which Ant Design Vue calls
// (responsiveObserve / useBreakpoint) when mounting responsive components such
// as <a-table> and <a-statistic>. Provide a minimal stub so those components
// mount cleanly in component tests.

import { vi } from 'vitest'

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated API some libs still call
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}
