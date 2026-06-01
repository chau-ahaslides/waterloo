-- WAT-12 (Stage 4): publish a Lesson and get a shareable link.
--
-- Adds the publishing surface to the NORMALIZED lesson model (a `lessons` row +
-- editable `lesson_slides` rows). Mirrors the `courses` table's existing
-- `share_link_slug` / `auth_mode` columns (0003) so lessons publish the same way
-- courses eventually will.
--
-- ── VERSIONING MODEL (draft-vs-published) ────────────────────────────────────
-- The `lesson_slides` rows are ALWAYS the editable DRAFT — the trainer edits
-- them in place via the WAT-11 editor (PATCH/reorder/delete/regenerate). On
-- Publish (and on "Update published version") we SNAPSHOT the current draft into
-- `published_slides_json` + `published_title`. The PUBLIC link serves ONLY this
-- snapshot, never the live draft.
--
-- This gives us all four requirements cleanly:
--   * Slug stable across republishes — `share_link_slug` is set ONCE on first
--     publish (NULL until then) and never regenerated; "Update published" only
--     refreshes the snapshot, not the slug.
--   * Editing a published lesson creates a new draft — the draft (lesson_slides)
--     diverges from the snapshot the moment the trainer edits; we detect that as
--     `updated_at > published_at` (editing bumps updated_at; publish/promote sets
--     published_at = the publish time so they re-converge). No row churn.
--   * "Update published version" promotes draft→live — re-snapshot draft into the
--     published_* columns and set published_at = now; slug untouched.
--   * Existing learner progress preserved — learners / learner_progress /
--     learner_responses are keyed to the STABLE lesson id and are NEVER touched
--     by publish/promote/unpublish. We only overwrite a JSON snapshot column, so
--     every learner row survives every republish.
--
-- `status` lifecycle extends 0002's 'draft'|'published' with 'unpublished':
--   draft       — never published (no slug yet, or unpublished back to draft).
--   published   — live; the public link resolves to published_slides_json.
--   unpublished — was published (slug + snapshot retained) but taken offline; the
--                 public link shows a "not available" state. Re-publishing reuses
--                 the same slug.
--
-- Non-destructive: ADD COLUMN only; existing rows default sensibly.

-- Public share-link slug. Unique when present; NULL until first publish, then
-- stable forever (reused across republish/unpublish/republish).
ALTER TABLE lessons ADD COLUMN share_link_slug TEXT;

-- How learners identify themselves on the public link:
--   'anonymous' (no identifier) | 'name' (name only) | 'email' (email required).
-- Default 'name' per the WAT-12 spec. Set BEFORE publishing; persisted on publish.
ALTER TABLE lessons ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'name';

-- Snapshot of the LIVE published version's slides — a JSON array of
-- { order, type, content } objects taken from lesson_slides at publish /
-- update-published time. NULL until first publish. The public link serves this,
-- so the live version keeps serving while the trainer edits the draft.
ALTER TABLE lessons ADD COLUMN published_slides_json TEXT;

-- Snapshot of the title at publish / update-published time (the draft title may
-- diverge once the trainer edits). NULL until first publish.
ALTER TABLE lessons ADD COLUMN published_title TEXT;

-- Unique slug lookup for the public-by-slug route (partial index — only rows
-- that actually have a slug participate, so multiple NULLs are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_slug
  ON lessons (share_link_slug) WHERE share_link_slug IS NOT NULL;
