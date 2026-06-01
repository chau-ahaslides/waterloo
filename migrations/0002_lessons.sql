-- WAT-3: lessons persisted server-side in D1.
--
-- Lessons used to live only in the creator's browser localStorage. The lesson
-- editor (WAT-3) makes D1 the source of truth so lessons are durable, editable,
-- shareable across devices, and publishable. The converter seeds a DRAFT lesson
-- here; the editor saves drafts; Publish flips status → published. The audience
-- Take page serves a lesson from this table.
--
-- The whole slide array is stored as a JSON blob (`slides`) — slides are an
-- opaque, slide-type-defined union owned by the pluggable slide-type registry,
-- so the backend stays generic and never needs a per-type schema or migration
-- when a new slide type is added.

CREATE TABLE IF NOT EXISTS lessons (
  -- Lesson id (e.g. lesson_<uuid>) — generated client-side or by the Worker.
  id             TEXT PRIMARY KEY,
  -- Source presentation id this lesson was converted from (0 if hand-authored).
  presentation_id INTEGER NOT NULL DEFAULT 0,
  title          TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  -- JSON array of lesson slides (slide-type-defined shapes; opaque to the API).
  slides         TEXT NOT NULL DEFAULT '[]',
  -- Lifecycle: 'draft' (editable, not audience-facing) | 'published'.
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  -- ISO-8601 timestamp of the first/most-recent publish; null while draft.
  published_at   TEXT
);

-- Home lists lessons newest-first.
CREATE INDEX IF NOT EXISTS idx_lessons_updated
  ON lessons (updated_at DESC);
