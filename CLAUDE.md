# Waterloo

Vue 3 + Ant Design Vue app styled with the AhaSlides design-token theme, deployed on Cloudflare Workers (static assets + Worker).

## Stack

- **Vite 7** + **Vue 3.5** + TypeScript
- **Ant Design Vue 4** — brand look delivered entirely through the design-token theme (`src/theme/antTheme.ts`), applied app-wide via `<a-config-provider :theme="ahaSlidesDefaultTheme">` in `src/App.vue`. Do NOT hand-build bespoke `Aha*` components.
- **Tailwind 3** — `aha-*` brand colors and `Plus Jakarta Sans` font (`tailwind.config.js`).
- **Cloudflare Workers** — `wrangler.jsonc` serves the built SPA from `./dist`; `/api/*` is routed to `worker/index.ts`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | `vue-tsc` type-check + production build to `dist/` |
| `npm run cf:dev` | Build, then run the Worker locally with `wrangler dev` |
| `npm run deploy` | Build + `wrangler deploy` to Cloudflare |

## Deployment

- **Live URL:** https://waterloo.ahaslides-game.workers.dev
- Account: `chau@ahaslides.com` (Cloudflare OAuth via wrangler).

### ⚠️ ALWAYS DEPLOY AFTER A FEATURE IS DONE

Whenever a feature or fix is complete and verified, run `npm run deploy` to push it live, then confirm the deployed URL renders correctly. Do not consider a task finished until it is deployed.

### ⚠️ SCREENSHOT EVERY UI CHANGE

For any task that changes the UI, always include a screenshot of the affected screen in the Slack reply (use the fleet `POST $BASE/tasks/:id/slack/upload` endpoint to attach it natively). Verify the change in a real browser before replying.

## Pages

### Presentation list (`src/views/PresentationList.vue`)

- Reads a JWT from the URL: `?token=<jwt>`. The token is swappable — just change the query param.
- Calls `GET /api/presentation/list/infinity-scroll/v2` on `presenter.dev.ahaslide.com` directly from the browser (the dev API sends `access-control-allow-origin: *`, so no proxy is needed), sending `Authorization: Bearer <token>`.
- API client lives in `src/api/presentations.ts`. Base URL overridable via `VITE_API_BASE`.
- Server-side pagination (50 items/page), sort-column + order controls, loading / empty / error / no-token states.

## Project context

This app is part of **Project AhaSlides e-Learning** — a self-paced course platform built on top of AhaSlides' existing interactive presentation engine. The strategic thesis is captured in [`docs/PROJECT-THESIS.md`](./docs/PROJECT-THESIS.md) (last fetched from Confluence 2026-06-01; re-fetch when stale).

Confluence source: https://ahaslides.atlassian.net/wiki/spaces/AT/pages/1881866288/Project+AhaSlides+e-Learning

Key concepts every worker should know: **lessons** (self-paced content units), **converter** (presentation → course), **pick-answer/quiz slides** (engagement layer), **blended delivery** (live ↔ self-paced bridge). The product thesis is that AhaSlides' moat is offering both live and async delivery on one platform — no other tool does this well.

## Testing

### Policy

Every major feature must have **test coverage**, written at different points in the workflow:

1. **Unit test** — pure logic (stores, mappers, helper functions). Added/updated automatically every time you change the relevant `src/` code.
2. **API-client test** — tests the `src/api/*.ts` client functions with `fetch` mocked (assert correct URL + headers built, response parsed, `ApiError` thrown on 401). Added/updated every time you change the relevant `src/api/` code.
3. **Component / UI-interaction test** — for each major view, MOUNT it with `@vue/test-utils`, MOCK the API/store module it imports (`vi.mock('@/api/…')`), and assert that the component **calls the API as expected** and **renders the returned data + handles user interactions** (clicks, selection, auto-advance, empty/error/loading states). This is what makes the API coverage "useful": it verifies the UI actually consumes and displays the data, not just that the client builds a URL.
4. **CF Worker test** — runs inside the real Workers runtime via `@cloudflare/vitest-pool-workers` (see below).
5. **E2E test** — one Playwright spec per major feature, added **ONLY after the user explicitly confirms the feature works as expected**. Do not write an E2E spec speculatively.

### ⚠️ HARD RULE: Unit + API tests are MANDATORY on every code change

Whenever you touch any file under `src/`, you MUST add or update the corresponding unit/API tests in the same commit. Skipping tests is not acceptable — this is a non-negotiable convention alongside the existing "always deploy after a feature" rule.

### Typical workflow per feature

```
change code → add/adjust unit+API tests → build (vue-tsc + vite build) → deploy
↓ (only after user confirms it works as expected)
add E2E test
```

### Two Vitest projects

Vitest runs **two projects** (configured inline in `vitest.config.ts` via `test.projects`) because they need different runtimes:

- **`unit`** — `jsdom` environment. Runs everything under `src/**/*.test.ts`: pure-logic unit tests, API-client tests, and the Vue **component / UI-interaction** tests.
- **`workers`** — `@cloudflare/vitest-pool-workers`. Runs everything under `tests/worker/**`. These execute **inside the real Workers runtime** (workerd, via Miniflare), with the real `env` / `ASSETS` binding derived from `wrangler.jsonc`.

### Running the test suites

| Command | What it runs |
| --- | --- |
| `npm test` | Both projects (`unit` + `workers`), single run |
| `npm run test:unit` | The `unit` project only (jsdom: logic + API + component tests) |
| `npm run test:watch` | Both projects in watch mode (for development) |
| `npm run test:worker` | The `workers` project only (CF Worker tests in workerd) |
| `npm run test:e2e` | Playwright E2E suite against the dev server |

### Where tests live

| Kind | Location | Project |
| --- | --- | --- |
| Unit + API client | `src/**/*.test.ts` (colocated) | `unit` (jsdom) |
| Component / UI-interaction | `src/views/*.test.ts` (colocated) | `unit` (jsdom) |
| CF Worker | `tests/worker/**/*.test.ts` | `workers` (workerd) |
| E2E | `tests/e2e/*.spec.ts` | Playwright |

### Tooling

- **Unit + API + component:** Vitest + `@vue/test-utils` + jsdom. Component tests mount the view, register Ant Design Vue (`global.plugins: [Antd]`), and `vi.mock(...)` the API/store modules so assertions are about render + interaction, not the network.
- **CF Worker tests:** `@cloudflare/vitest-pool-workers` — the official Cloudflare Vitest integration. Tests run **inside workerd** (via Miniflare) with the real `env`/`ASSETS` binding from `wrangler.jsonc`. Wired in `vitest.config.ts` with the `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })` plugin on the `workers` project. Worker-test types come from `tests/worker/tsconfig.json` (`types: ["@cloudflare/vitest-pool-workers/types"]`).
- **E2E:** Playwright (`@playwright/test`) — config at `playwright.config.ts`

### Seeded tests (one per major feature)

| Feature | Test file |
| --- | --- |
| Lessons store + converter | `src/lessons/lessons.test.ts` |
| Presentations API client | `src/api/presentations.test.ts` |
| Slides API client + `isPickAnswerSlide` | `src/api/slides.test.ts` |
| LessonPlay playback logic (pure) | `src/views/LessonPlay.test.ts` |
| PresentationList view (component) | `src/views/PresentationList.test.ts` |
| Home / My Lessons view (component) | `src/views/Home.test.ts` |
| ConverterModal view (component) | `src/views/ConverterModal.test.ts` |
| LessonPlay view (component) | `src/views/LessonPlay.component.test.ts` |
| CF Worker routing | `tests/worker/worker.test.ts` |

### Component tests — what they assert

- **PresentationList** — mounts, mocks `@/api/presentations`; asserts the API is called with the default list params, the returned presentations render (name, access code, slide count, total), the no-token / empty / error states show, and the error **Retry** button re-invokes the API.
- **Home** — mocks `@/lessons/lessons` + `getToken` + the router; asserts the welcome/empty state, the lessons grid (title, question count, id tag), the **Preview** button pushes to `lesson-play`, and delete calls the store.
- **ConverterModal** — mocks the API + converter; asserts it lists presentations on open, supports multi-select, and on confirm converts each selected id, persists via `addLessons`, and emits `created` (and surfaces "skipped" when a presentation has no pick-answer slides).
- **LessonPlay** — mocks the store + router; drives the real UI with fake timers: renders the question + options, a correct answer tallies the score and auto-advances after 800ms, a perfect/partial run reaches the completion screen with the right score, the double-tap guard holds, and an unknown lesson id shows "Lesson not found".

### CF Worker test — what it covers and how it works

`tests/worker/worker.test.ts` runs in the **`workers` project** (`@cloudflare/vitest-pool-workers`), so it executes inside the real Workers runtime (workerd) with bindings from `wrangler.jsonc` — not a stub. It drives the Worker two ways: `SELF.fetch()` (full edge routing incl. `run_worker_first`) and `worker.fetch(req, env)` (the default export with the real `env`).

Assertions:
- `GET /api/health` → 200 JSON `{ok:true, service:"waterloo"}` (via `SELF.fetch` and via the direct export)
- `GET /api/<unknown>` → 404 JSON `{error:"Not found"}`
- non-`/api` paths → delegate to the **real `env.ASSETS` binding** (SPA / static-asset fallback)
