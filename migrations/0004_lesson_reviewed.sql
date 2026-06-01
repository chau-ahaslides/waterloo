-- WAT-11: lesson "reviewed" gate.
--
-- The trainer must open the lesson detail/edit page at least once before they
-- can publish (Stage 4 will gate publish on this flag). On first page open the
-- frontend calls POST /api/courses/lessons/:id/reviewed which sets this to 1.
--
-- Non-destructive ADD COLUMN: existing rows default to 0 (not yet reviewed).
ALTER TABLE lessons ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0;
