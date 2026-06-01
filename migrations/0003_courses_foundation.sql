-- WAT-8: Courses-feature foundation (STAGE 1 of WAT-8..15).
--
-- Sets up the data models for the self-paced LEARNING/COURSES feature
-- (docs/PROJECT-THESIS.md: "Trainers build interactive courses on AhaSlides.
-- Learners complete them at their own pace."). Models only — no UI, no business
-- logic. The /api/courses routes are stubs for now.
--
-- RECONCILIATION WITH EXISTING SCHEMA (read carefully):
-- ─────────────────────────────────────────────────────
-- This DB (waterloo-lessons) already holds two live tables from earlier work
-- for a DIFFERENT stakeholder/flow:
--   * `lessons`  (0002) — a lesson with its slides stored as ONE JSON blob;
--                 powers the live editor / converter / audience Take player.
--   * `attempts` (0001) — audience submissions (per-slide responses as JSON);
--                 powers the live Take/Report flow.
--
-- WAT-8 specifies a MORE NORMALIZED model: a separate `LessonSlide` table
-- (one row per slide) instead of the JSON blob, and `Learner` /
-- `LearnerProgress` / `LearnerResponse` instead of `attempts`. This OVERLAPS
-- and partly conflicts with the live tables. To stay NON-DESTRUCTIVE this
-- migration:
--   1. EVOLVES the existing `lessons` table by ADDING new nullable columns the
--      Courses spec needs (owner_id, source_presentation_id,
--      estimated_duration_minutes, language). It does NOT drop/rename any
--      existing column or change its meaning. The legacy `presentation_id`
--      column (0002) stays as-is; the spec's `source_presentation_id` is added
--      alongside as a new nullable column.
--   2. ADDS a new normalized `lesson_slides` table (the spec's LessonSlide).
--      The live editor keeps using `lessons.slides` (JSON blob); the Courses
--      feature can populate `lesson_slides` going forward. Both representations
--      coexist for now — convergence is a DELIBERATE later decision, flagged to
--      the requester, NOT done silently here.
--   3. ADDS the new Course-side tables (courses, course_lessons, learners,
--      learner_progress, learner_responses) cleanly alongside `attempts`.
--      `attempts` is left untouched so the live Take/Report flow keeps working;
--      `learner_responses` is the Courses-feature successor, not a replacement
--      applied to the live flow.
--
-- DUALITY FLAG: after this migration there are TWO lesson models in one DB —
-- the legacy JSON-blob `lessons.slides` (live app) and the new normalized
-- `lesson_slides` rows (Courses feature). They are NOT yet wired together.
-- The requester is asked (in Slack) to confirm whether/when to converge them.

-- ── 1. Lesson: evolve the existing table (ADD nullable columns only) ─────────
-- SQLite ADD COLUMN is non-destructive: existing rows get NULL. No defaults are
-- forced so we don't change the meaning of existing data.
ALTER TABLE lessons ADD COLUMN owner_id TEXT;
ALTER TABLE lessons ADD COLUMN source_presentation_id INTEGER;
ALTER TABLE lessons ADD COLUMN estimated_duration_minutes INTEGER;
ALTER TABLE lessons ADD COLUMN language TEXT;

-- ── 2. LessonSlide: normalized per-slide rows (the spec's LessonSlide) ───────
-- One row per slide in a lesson, ordered. `content` is a JSON blob carrying the
-- slide-type-defined payload (kept opaque, like lessons.slides — the slide-type
-- registry owns the shape). `type` is the lesson-level category from the spec
-- (question/explanation), distinct from the fine-grained slide-type key inside
-- `content`.
CREATE TABLE IF NOT EXISTS lesson_slides (
  id          TEXT PRIMARY KEY,
  lesson_id   TEXT NOT NULL,
  -- 0-based (or 1-based; ordering only) position within the lesson.
  "order"     INTEGER NOT NULL DEFAULT 0,
  -- 'question' | 'explanation' (lesson-level category from the WAT-8 spec).
  type        TEXT NOT NULL DEFAULT 'explanation',
  -- JSON blob: slide-type-defined content (opaque to the API).
  content     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_lesson_slides_lesson
  ON lesson_slides (lesson_id, "order");

-- ── 3. Course: a container of multiple Lessons ──────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  owner_id        TEXT,
  -- Public share-link slug (unique when present); null while unpublished/no link.
  share_link_slug TEXT,
  -- How learners identify themselves: 'anonymous' | 'name' | 'email'.
  auth_mode       TEXT NOT NULL DEFAULT 'anonymous',
  -- Lesson navigation: 'free' (any order) | 'sequential' (must complete in order).
  order_mode      TEXT NOT NULL DEFAULT 'free',
  -- Lifecycle: 'draft' | 'published'.
  status          TEXT NOT NULL DEFAULT 'draft',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_slug
  ON courses (share_link_slug) WHERE share_link_slug IS NOT NULL;

-- ── 4. CourseLesson: ordered membership of lessons within a course ──────────
CREATE TABLE IF NOT EXISTS course_lessons (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  lesson_id   TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_course_lessons_course
  ON course_lessons (course_id, "order");

-- ── 5. Learner: a person taking a course ────────────────────────────────────
CREATE TABLE IF NOT EXISTS learners (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  -- Name or email per the course's auth_mode; null for anonymous learners.
  identifier  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learners_course
  ON learners (course_id);

-- ── 6. LearnerProgress: a learner's progress through one lesson ─────────────
CREATE TABLE IF NOT EXISTS learner_progress (
  id                  TEXT PRIMARY KEY,
  learner_id          TEXT NOT NULL,
  lesson_id           TEXT NOT NULL,
  -- The slide order the learner has reached within the lesson.
  current_slide_order INTEGER NOT NULL DEFAULT 0,
  -- ISO-8601 timestamp set when the learner completes the lesson; null until then.
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_learner_progress_learner
  ON learner_progress (learner_id, lesson_id);

-- ── 7. LearnerResponse: a learner's answer to one lesson slide ──────────────
-- The Courses-feature successor to the live `attempts` table. `attempts` is
-- left untouched (live Take/Report flow); this is NOT yet wired to it.
CREATE TABLE IF NOT EXISTS learner_responses (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  lesson_slide_id TEXT NOT NULL,
  -- JSON or scalar response payload (slide-type-defined; stored as text).
  response_value  TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learner_responses_learner
  ON learner_responses (learner_id);
CREATE INDEX IF NOT EXISTS idx_learner_responses_slide
  ON learner_responses (lesson_slide_id);
