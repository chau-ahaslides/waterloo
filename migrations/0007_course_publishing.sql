-- WAT-14 (Stage 6): Course container — publish surface + course-scoped learners.
--
-- A Course (0003 `courses` + `course_lessons`) groups multiple published Lessons
-- behind ONE share link (ahaslides.com/learn/c/[slug]). This migration adds the
-- publish snapshot the public course link serves, mirroring the lesson publishing
-- model (0005): publish snapshots the current membership (ordered lesson ids +
-- title) so the live link keeps serving while the trainer edits the draft.
--
-- ── Course publish snapshot ──────────────────────────────────────────────────
-- `published_lessons_json` — JSON array of { lessonId, slug, title, order } taken
--   at publish/update-published time from course_lessons (+ each member lesson's
--   live published state). NULL until first publish.
-- `published_title` — title snapshot at publish time. NULL until first publish.
-- `published_at` — ISO-8601 of last publish/update-published. NULL until first.
--
-- The `courses` table already has share_link_slug / auth_mode / order_mode /
-- status (0003), so publishing reuses those exactly like lessons do.
--
-- Non-destructive: ADD COLUMN only; existing rows default to NULL.
ALTER TABLE courses ADD COLUMN published_lessons_json TEXT;
ALTER TABLE courses ADD COLUMN published_title TEXT;
ALTER TABLE courses ADD COLUMN published_at TEXT;

-- ── Course-scoped learner progress ───────────────────────────────────────────
-- A course learner (learners.course_id set, lesson_id NULL) tracks per-lesson
-- completion via learner_progress, exactly like a standalone-lesson learner. We
-- add a nullable `course_id` to learner_progress so a row can be scoped to a
-- course context (so the same physical lesson can be tracked independently when
-- taken inside a course vs. standalone). The existing (learner_id, lesson_id)
-- index still serves the per-learner lookup; course learners always carry a
-- distinct learner_id, so there is no cross-talk with standalone progress.
ALTER TABLE learner_progress ADD COLUMN course_id TEXT;

CREATE INDEX IF NOT EXISTS idx_learner_progress_course
  ON learner_progress (learner_id, course_id);

-- Start-or-resume lookup for course learners: (course_id, identifier).
CREATE INDEX IF NOT EXISTS idx_learners_course_identifier
  ON learners (course_id, identifier);
