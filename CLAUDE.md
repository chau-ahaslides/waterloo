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

## Slide-type architecture

Lessons are a sequence of slides of different **types**. The slide-type layer is
**pluggable**: each type is a self-contained module under `src/slide-types/<name>/`
that owns its conversion, its render+response component, and its tests. The
generic player (`LessonPlay.vue`), converter (`lessons.ts`) and `ConverterModal.vue`
never reference a concrete type — they talk only to the registry + contract.

- **Contract** — `src/slide-types/types.ts` (`SlideTypeModule`). A module declares:
  - `type` — the lesson slide-type key (e.g. `'pickAnswer'`, `'infoSlide'`),
  - `hasResponse` — `true` = captures an answer (scored, auto-advances after
    feedback); `false` = **info-only** (purely shows content, advances on a
    Continue click, never scored),
  - `convert(rawPresenterSlide) => LessonSlide | null` — recognise + map a raw
    AhaSlides slide into this type, or `null` if it isn't this type,
  - `component` — the Vue component that renders the slide in the audience/preview
    view AND receives its own response. Contract for props/emits:
    - props: `{ slide, showingFeedback, response }`
    - emits: response types → `answered` (payload = the response); info-only →
      `continue` (no payload),
  - `scoreFor(slide, response) => 0 | 1` — optional; response types only.
  - `snapshotFor(slide, response) => { question, response, correct }` — optional;
    builds a self-contained, report-friendly snapshot of a captured response.
    The audience-submission flow stores this per response-bearing slide so the
    report renders from persisted D1 data alone (the lesson definition lives only
    in the creator's localStorage). The registry falls back to a generic snapshot
    when a module omits it.
- **Registry** — `src/slide-types/registry.ts`. Registers all modules and exposes
  `convertRawSlide`, `getSlideComponent`, `typeHasResponse`, `scoreForSlide`,
  `snapshotForSlide`.
- **Modules today** — `pickAnswer/` (multiple-choice, response, scored) and
  `infoSlide/` (maps AhaSlides `freestyle` content/heading slides → an info-only
  titled card with a Continue button, no response).

### Adding a new slide type (NOTHING else changes)

1. `mkdir src/slide-types/<name>/`, create `module.ts` (implements `SlideTypeModule`)
   + `<Name>Slide.vue` (the render+response component) + `module.test.ts`
   (convert + scoring/response + a component mount test).
2. Add the module to `SLIDE_TYPE_MODULES` in `src/slide-types/registry.ts` (one line).

The player, converter and ConverterModal pick it up automatically. See
[`docs/SLIDE-TYPES.md`](./docs/SLIDE-TYPES.md) for the full walkthrough.

## Lesson playback: preview, take & report (WAT-5)

There is **one** shared player, `src/views/LessonPlayer.vue` — the slide-type-
agnostic playback experience (header, progress, per-type rendering, scoring,
auto-advance). It collects per-slide response snapshots generically via the
registry's `snapshotForSlide` and emits `complete({ score, total, responses })`.
Two routes embed it (never copy-paste a second player):

- **Preview** — `src/views/LessonPlay.vue` (`/lesson/:id/play`). Local, NON-submitting
  run with a "try again" completion screen. Reachable via the **Preview** button on
  the Home lesson card.
- **Take** — `src/views/TakeLesson.vue` (`/lesson/:id/take`). The REAL audience run:
  a start screen (optional free-text name) → playback → POSTs the attempt to the
  D1-backed API → confirmation + "View report" link. Audience can retake; each run
  posts a NEW attempt. Reachable via the **Take** button on the Home lesson card.
- **Report** — `src/views/LessonReport.vue` (`/lesson/:id/report`). Fetches all
  attempts for a lesson and shows summary stats (attempt count, average score), an
  attempts table (audience, when, score/total), and a per-question breakdown
  (% correct) built entirely from the persisted response snapshots. Reachable via
  the **Report** button on the Home lesson card and the take completion screen.
  Handles loading / empty / error states.

### Attempts API + D1 backend

Audience submissions are persisted in a **Cloudflare D1** database
`waterloo-lessons` (binding `env.DB` in `wrangler.jsonc`; database_id
`175bbb2b-0de3-4ea5-8813-19b7647b933e`). Schema lives in `migrations/`
(`0001_attempts.sql`). Apply with:

```
npx wrangler d1 migrations apply waterloo-lessons            # local
npx wrangler d1 migrations apply waterloo-lessons --remote   # deployed
```

**Schema** — table `attempts`: `id` (text PK, UUID), `lesson_id` (text, indexed),
`audience_name` (text, nullable), `score` (int), `total` (int), `responses`
(JSON text — array of `{ slideId, type, question, response, correct }` snapshots),
`created_at` (ISO-8601). Multiple attempts per lesson are allowed — every POST is
a **new row** (no upsert/dedupe). Each row embeds a self-contained question/answer
snapshot so the report renders from D1 alone (the lesson definition is
localStorage-only).

**Routes** (`worker/index.ts`, JSON in/out):

| Verb | Path | Purpose |
| --- | --- | --- |
| POST | `/api/lessons/:lessonId/attempts` | Insert ONE attempt; returns `{ attempt }` (201). Body: `{ audienceName?, score, total, responses[] }`. |
| GET  | `/api/lessons/:lessonId/attempts` | All attempts for a lesson, newest-first: `{ attempts[] }`. |

Client: `src/api/attempts.ts` (`submitAttempt`, `fetchAttempts`) — calls the
SAME-ORIGIN Worker via relative `/api/...` (not `presenter.dev`); no token needed.

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
| Slide-type registry | `src/slide-types/registry.test.ts` |
| Pick-answer slide-type module + component | `src/slide-types/pickAnswer/module.test.ts` |
| Info slide-type module + component | `src/slide-types/infoSlide/module.test.ts` |
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

## UI alignment checklist

Run through this checklist on every PR that touches a `.vue` file in `src/views/`.

### Icon + text rows

- [ ] Every row that places an icon next to text uses `flex items-center gap-<N>` on the parent (or `inline-flex items-center gap-<N>` for inline spans). Never rely on default `block` layout to align an icon with adjacent text.
- [ ] Add `shrink-0` to standalone icon elements so they never compress and shift off-baseline when the sibling text is long.

### Ant Design card covers

- [ ] If a `<template #cover>` root element needs `flex` centering, use `!flex` (Tailwind's `!important` prefix). Ant Design's `.ant-card-cover > *` rule forces `display: block` on direct children, silently overriding `.flex`. Use `!flex items-center justify-center` on the cover root to override it.

### Button icon + label alignment

- [ ] Every `<a-button>` that has both an `#icon` slot and a visible label must add `class="inline-flex items-center"` (or `class="flex items-center"` for block-level buttons). Without it, Ant Design's default `<span>` wrapper inside the button causes the icon and label to sit on different baselines, especially at `size="small"`.
- [ ] Icon-only `<a-button>` (no visible label) should use `class="inline-flex items-center justify-center"` so the glyph is optically centred in the button hit-target.

### Header / control rows

- [ ] Page headers that have a title block on the left and controls on the right must use `flex flex-wrap items-center justify-between gap-<N>`. Both the title `<div>` and the controls `<div>` must use `shrink-0` so they never collapse or overflow each other.
- [ ] Replace `<a-space>` with `<div class="flex items-center gap-<N>">` for control rows. `a-space` uses inline spacing that does not guarantee vertical alignment across different child types (buttons, selects, icons).
- [ ] Button groups should all share the same `size` prop (default, small, large). Mixed sizes produce uneven baselines.

### Cards / grids

- [ ] Cards in a grid (`grid grid-cols-N gap-M`) must all have the same height. Use Ant Design's `:body-style="{ padding: '16px' }"` consistently. Avoid setting arbitrary heights on card bodies.
- [ ] Thumbnail / cover image areas must have a fixed height class (`h-28`, `h-32`, etc.) so cards align across a row regardless of image content.
- [ ] Info rows inside cards (e.g. slide count + access code) must use `flex items-center gap-<N>` with `inline-flex items-center gap-1` wrappers on each icon+text pair.

### Single-column audience / full-screen views (LessonPlay)

- [ ] Full-screen centered screens (`v-if="!lesson"`, completion, empty) must use `flex min-h-[100dvh] w-full flex-col items-center justify-center` — NOT `min-h-screen` (which can be shorter than the viewport on mobile with browser chrome).
- [ ] Screens that are single-column by design should have a content max-width (`max-w-2xl`, `max-w-lg`, etc.) with `mx-auto` so content does not stretch uncomfortably on wide screens.
- [ ] The progress bar in a full-width layout needs `block w-full` to prevent any margin collapse; use `!m-0` to override component default margins.

### Spacing scale

- [ ] Use Tailwind spacing tokens (`gap-2`, `gap-3`, `gap-4`, `px-6`, `py-4`, …) rather than arbitrary pixel values (`style="margin: 5px"`). Arbitrary values bypass the design-system scale and are invisible to future alignment audits.

### Verification before replying

- [ ] Open the app in a real browser (Chrome DevTools MCP or `npm run dev`) — never rely solely on code inspection.
- [ ] Check at both desktop (≥ 1280 px) and mobile (375 px) widths.
- [ ] Check at least: Home (empty + cards grid), PresentationList (header + grid), ConverterModal (list + footer), LessonPlay (active quiz + completion + not-found).
- [ ] Screenshot each affected view and attach to the Slack reply via `POST $BASE/tasks/:id/slack/upload`.
