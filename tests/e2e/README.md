# E2E Tests

E2E tests for Waterloo live in this directory and are run with Playwright.

## Policy

**E2E specs are added one per major feature, ONLY after the user confirms the
feature works as expected.** Do not write an E2E spec speculatively — wait for
sign-off first.

This directory intentionally has no feature specs yet. As each feature is
confirmed working by the user, add a spec file here, e.g.:

- `presentation-list.spec.ts` — after user confirms the presentation list page
- `home-lessons.spec.ts` — after user confirms the lessons home page
- `converter.spec.ts` — after user confirms the converter modal flow

## Running E2E

```bash
npm run test:e2e
```

The dev server (Vite, port 5173) is started automatically. To reuse an already
running server, just run `npm run test:e2e` — Playwright will detect it.
