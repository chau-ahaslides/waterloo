-- WAT-13 (Stage 5): attach a learner to a standalone published LESSON.
--
-- WAT-8 modelled `learners.course_id` as course-scoped (a learner joined a
-- COURSE). Stage 5 publishes a single Lesson directly via `/learn/:slug`, with
-- no enclosing course — so a learner must be able to attach to a LESSON on its
-- own. Rather than overload `course_id` (which is NOT NULL and semantically a
-- course id), we add a nullable `lesson_id` column. Exactly one of
-- (course_id, lesson_id) is meaningful per row going forward:
--   * course-scoped learner (future)        → course_id set, lesson_id NULL
--   * standalone-lesson learner (Stage 5)    → lesson_id set, course_id = '' (sentinel)
--
-- `course_id` stays NOT NULL (0003) to avoid a destructive table rebuild in
-- SQLite; standalone-lesson learners write the empty string there. The new
-- index supports the start-or-resume lookup: "find a learner for THIS lesson by
-- identifier".
--
-- Non-destructive: ADD COLUMN + CREATE INDEX only. Existing course learners are
-- untouched (lesson_id defaults to NULL).

ALTER TABLE learners ADD COLUMN lesson_id TEXT;

-- Start-or-resume lookup key: (lesson_id, identifier). Identifier is the name or
-- email the learner entered; unique per lesson is enforced in application code
-- (a partial unique index can't span the nullable identifier cleanly here, and
-- anonymous learners never hit this table — they persist in localStorage).
CREATE INDEX IF NOT EXISTS idx_learners_lesson
  ON learners (lesson_id, identifier);
