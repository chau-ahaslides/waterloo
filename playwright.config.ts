import { defineConfig, devices } from '@playwright/test'

// Playwright E2E config for Waterloo.
//
// Bootstrapped in WAT-4 — tests live in `tests/e2e/` and drive the dev server
// (Vite, port 5173). The dev server is started automatically; reuse it locally
// if one is already running.
//
// Per project policy (see CLAUDE.md ## Testing):
//   E2E tests are added ONLY after the user confirms a feature works as
//   expected. Do NOT add a feature E2E spec unless the user has explicitly
//   signed off on that feature.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
