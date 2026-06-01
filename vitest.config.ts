import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

// Read the project's D1 migrations so the workers test project can apply them
// into each test file's isolated D1 instance (via applyD1Migrations +
// env.TEST_MIGRATIONS). Schema in tests then matches production exactly.
const migrationsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
)
const migrations = await readD1Migrations(migrationsPath)

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
          // Stub window.matchMedia for Ant Design responsive components.
          setupFiles: ['./src/test-setup.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Expose the parsed migrations to tests as env.TEST_MIGRATIONS so
              // applyD1Migrations() can set up the schema per test file.
              bindings: { TEST_MIGRATIONS: migrations },
            },
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
