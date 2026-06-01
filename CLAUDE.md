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

Every major feature must have **three kinds of test coverage**, written at different points in the workflow:

1. **Unit test** — pure logic (stores, mappers, helper functions). Added/updated automatically every time you change the relevant `src/` code.
2. **API test** — tests the `src/api/*.ts` client functions with `fetch` mocked (assert correct URL + headers built, response parsed, `ApiError` thrown on 401). Added/updated automatically every time you change the relevant `src/api/` code.
3. **E2E test** — one Playwright spec per major feature, added **ONLY after the user explicitly confirms the feature works as expected**. Do not write an E2E spec speculatively.

### ⚠️ HARD RULE: Unit + API tests are MANDATORY on every code change

Whenever you touch any file under `src/`, you MUST add or update the corresponding unit/API tests in the same commit. Skipping tests is not acceptable — this is a non-negotiable convention alongside the existing "always deploy after a feature" rule.

### Typical workflow per feature

```
change code → add/adjust unit+API tests → build (vue-tsc + vite build) → deploy
↓ (only after user confirms it works as expected)
add E2E test
```

### Running the test suites

| Command | What it runs |
| --- | --- |
| `npm test` | All unit + API tests (Vitest, single run) |
| `npm run test:unit` | Same as above |
| `npm run test:watch` | Unit + API tests in watch mode (for development) |
| `npm run test:e2e` | Playwright E2E suite against the dev server |

### Where tests live

| Kind | Location |
| --- | --- |
| Unit + API | `src/**/*.test.ts` (colocated with source files) |
| E2E | `tests/e2e/*.spec.ts` |

### Tooling

- **Unit + API:** Vitest (`vitest`) + `@vue/test-utils` + jsdom
- **E2E:** Playwright (`@playwright/test`) — config at `playwright.config.ts`

### Seeded tests (one per major feature)

| Feature | Test file |
| --- | --- |
| Lessons store + converter | `src/lessons/lessons.test.ts` |
| Presentations API client | `src/api/presentations.test.ts` |
| Slides API client + `isPickAnswerSlide` | `src/api/slides.test.ts` |
