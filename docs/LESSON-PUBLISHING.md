# Lesson publishing & versioning (WAT-12 / Stage 4)

How a trainer publishes an individual **Lesson** (not a Course — that's Stage 6)
and gets a shareable link that works for anyone (no AhaSlides account).

## Versioning model: draft-vs-published snapshot

The normalized `lesson_slides` rows are **always the editable DRAFT**. The
trainer edits them in place via the WAT-11 editor (save / reorder / delete /
regenerate). Publishing **snapshots** that draft.

| Column (on `lessons`)    | Role                                                                 |
|--------------------------|----------------------------------------------------------------------|
| `share_link_slug`        | Public slug. NULL until first publish, then **stable forever**.      |
| `auth_mode`              | `anonymous` \| `name` \| `email`. Default `name`. Set before publish.|
| `published_slides_json`  | Snapshot of the LIVE slides at publish/update-published time.        |
| `published_title`        | Snapshot of the title at publish/update-published time.              |
| `status`                 | `draft` \| `published` \| `unpublished`.                             |
| `published_at`           | Timestamp of the last publish/promote.                               |

The public link serves **only `published_slides_json`** — never the live draft.

### Why this satisfies the four requirements

- **Slug stable across republishes** — the slug is generated once on first
  publish and never regenerated. Unpublish keeps it; re-publish reuses it;
  "Update published version" never touches it.
- **Editing a published lesson creates a new draft** — editing the draft
  (`lesson_slides`) bumps `lessons.updated_at`. A published lesson with
  `updated_at > published_at` has an **unpublished draft** (`hasDraftChanges`).
  The live snapshot keeps serving the previous version until promoted.
- **"Update published version" promotes draft → live** — re-snapshots the draft
  into `published_*` and re-syncs `published_at`, so `hasDraftChanges` clears.
- **Existing learner progress preserved across republishes** — `learners`,
  `learner_progress`, `learner_responses` are keyed to the **stable lesson id**
  and are never touched by publish/promote/unpublish. We only overwrite a JSON
  snapshot column, so every learner row survives every republish.

## API

| Method | Route                                            | Purpose                                              |
|--------|--------------------------------------------------|------------------------------------------------------|
| GET    | `/api/courses/lessons/:id/publish-state`         | publishing fields (status, slug, authMode, draft).   |
| PUT    | `/api/courses/lessons/:id/auth-mode`             | set `auth_mode` before publishing.                   |
| POST   | `/api/courses/lessons/:id/publish`               | publish; **requires `reviewed=true`** (409 if not).  |
| POST   | `/api/courses/lessons/:id/update-published`      | promote draft → live (slug unchanged; 409 if never published). |
| POST   | `/api/courses/lessons/:id/unpublish`             | take offline (slug + snapshot retained).             |
| GET    | `/api/learn/:slug`                               | PUBLIC — resolve slug → live published lesson, or 404 `{available:false}`. |

## Link format

Display: `ahaslides.com/learn/[slug]` (per spec). The working route on this
deploy is `<origin>/learn/[slug]` — a placeholder learner landing that shows
"published" or "not available". The real learner **player** is Stage 5 (WAT-13).
