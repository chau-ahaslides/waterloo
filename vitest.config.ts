import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

// Two test projects with different runtimes:
//   - "unit"    → jsdom, for the Vue component/interaction tests + API-client
//                 unit tests + lessons store (everything under src/**).
//   - "workers" → @cloudflare/vitest-pool-workers, which runs the tests INSIDE
//                 workerd via Miniflare with the REAL `env`/ASSETS binding
//                 derived from wrangler.jsonc. Covers tests/worker/**.
//
// `npm test` runs both projects; `npm run test:worker` filters to "workers".
// https://vitest.dev/guide/projects + https://developers.cloudflare.com/workers/testing/vitest-integration/
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
          }),
        ],
        resolve: { alias },
        test: {
          name: 'workers',
          include: ['tests/worker/**/*.test.ts'],
        },
      },
    ],
  },
})
