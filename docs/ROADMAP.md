# Waterloo — Product Roadmap

**Last updated:** 2026-06-01 (WAT-3 round 3)
**Owner:** underground-station/Paddington

This roadmap is grounded in [`PROJECT-THESIS.md`](./PROJECT-THESIS.md) (blended
live ↔ async; curate/enrich existing AhaSlides content — **not** a from-scratch
LMS) and the later-phases section of
[`LESSON-EDITOR-REQUIREMENTS.md`](./LESSON-EDITOR-REQUIREMENTS.md). It reflects
the app **as it actually ships today**, after a full functional + UI QA pass.

## Where we are today (shipped)

The MVP and a good chunk of the originally-planned Phase 2/3 are live:

- **Converter** — presentation → draft lesson (pulls supported slides from a real deck).
- **Editor** (`/lessons/:id/edit`) — two-pane outline + per-slide form; add / reorder /
  remove; lesson title + description; Save draft; Publish (`draft` → `published`).
- **Authorable slide types** — Quiz (formative pick-answer), Text, HTML (render-time
  XSS-sanitised allowlist), YouTube (URL or bare id → privacy `nocookie` embed).
  Pluggable slide-type registry (WAT-7) — new types need no player/editor changes.
- **D1 backend** — lessons are the single source of truth (no localStorage); attempts
  persisted; report aggregates all attempts + per-question %.
- **Take** (`/lesson/:id/take`) — learner run, submits attempts; multiple attempts allowed.
- **Report** (`/lesson/:id/report`) — attempts list, average score, per-question breakdown.
- 162 tests (jsdom unit/component + workers-pool D1).

### Known gaps surfaced during QA (carry into the roadmap below)

1. **Auth is a single hard-coded `DEV_TOKEN`.** No real users, no ownership, no
   per-trainer isolation — every visitor sees and edits the same lessons. This is
   the single biggest blocker to being a real product. (→ P1)
2. **No learner identity or progress.** "Audience name" is a free-text optional
   field; there's no concept of a learner who resumes a course or whose completion
   is tracked. The thesis's progress-dashboard moat needs this. (→ P1/P2)
3. **No blended-delivery dashboard.** The Report is per-lesson attempts only; the
   "spot where learners struggle → pull into a live session" loop (the moat) is
   not yet expressed. (→ P2)
4. **Thin slide-type palette vs. the AhaSlides catalogue.** Only quiz/text/html/
   youtube. Poll, open-ended/Q&A, word cloud, slider, image, multi-select scoring
   are unconverted/unauthorable. (→ P2)
5. **Quiz is formative-only.** No points, pass threshold, or graded "knowledge
   check" section — required for assessment use-cases. (→ P2)
6. **No validation gate.** A lesson can be published with an empty quiz (0 options)
   or a quiz with no correct answer — the converter even produced one such slide
   from deck E4UIY. Publish should warn/block on invalid slides. (→ P2, quick win)
7. **Minor UX/copy nits** (→ P3, batchable):
   - Info-only slide's final button reads "Continue", not "Finish" (player doesn't
     pass `isLast` to slide components).
   - Take start screen + completion always say "Answer each question… answers saved"
     even for lessons with zero questions.
   - Converted quiz slides can arrive titled "Untitled question" with no options.

> Fixed this round: lesson-card action row clipped Report + delete inside the
> `overflow-hidden` card (now wraps); score badge briefly showed "1 / 0 correct"
> during the feedback window (denominator now counts the in-feedback slide).

---

## Prioritised roadmap

### P1 — Make it a real multi-tenant product (the unlock)

The current app is a single-tenant demo. Everything else is gated on this.

1. **Real auth + lesson ownership.** Replace the hard-coded `DEV_TOKEN` fallback
   with the trainer's AhaSlides identity (the `?token=` JWT already carries a user
   id — `42757` in the dev token). Stamp `owner_id` on lessons + attempts; scope
   every list/read/write to the authenticated trainer. *This is the prerequisite
   for multi-user, sharing, and any dashboard.*
2. **Shareable published-lesson links for learners.** A learner opening a lesson
   should NOT need the trainer's JWT. Issue a public, capability-scoped lesson link
   (`/l/:publicId`) that grants take-only access to a *published* lesson — no editor,
   no other lessons. This is the actual "deliver to learners" step the thesis needs.

### P2 — Close the thesis loop: blended delivery, richer content, assessment

3. **Learner progress + the blended dashboard (the moat).** Track per-learner
   completion/score across a lesson; surface a trainer dashboard that highlights
   *which slides learners struggle on* — the explicit "pull weak topics into a live
   AhaSlides session" workflow from the thesis. Builds directly on the existing
   attempts/Report data.
4. **Expand the slide-type palette toward the AhaSlides catalogue.** Highest-value
   next types, in order: **Poll / open-ended (Q&A)** and **multi-select / scored
   quiz**, then **Image** and **Slider / word cloud**. The registry already makes
   each additive; pair each with converter support so existing decks light up.
5. **Graded assessment mode.** Add points + pass-threshold as an opt-in per lesson
   (keep formative as the default). Show pass/fail on completion and in the Report.
6. **Publish validation gate.** Block/warn on invalid slides at publish time
   (empty quiz, no correct answer, blank required text, unparseable YouTube id).
   Low effort, high trust — directly addresses the bad converted slide seen in QA.
7. **Sections / chapters** once lessons grow beyond a flat list (e.g. when multiple
   presentations merge into one lesson).

### P3 — Polish, trust, reach

8. **Accessibility pass.** Keyboard nav for the outline reorder, focus management
   between slides, ARIA on the score badge / live feedback, colour-contrast audit
   of the brand palette on quiz buttons. Lighthouse a11y as a CI gate.
9. **i18n / l10n.** The thesis user base is global (Vani at KiotViet — Vietnamese;
   decks already contain 日本語 / Tiếng Việt). Externalise UI strings; the content
   itself is already author-language-agnostic.
10. **Editor niceties.** Undo for destructive actions (delete slide/option),
    duplicate-slide, device-size preview, drag-reorder (keyboard fallback exists).
11. **UX/copy cleanup batch** — the P3 nits listed in "Known gaps" above
    (Finish-vs-Continue, info-only take copy, untitled-quiz default).
12. **Analytics depth in Report** — score distribution, attempts over time, export.

---

## Explicitly NOT building (per thesis)

Not a full LMS, not a course marketplace, not Moodle/Blackboard. Waterloo stays
the *simple, beautiful, interactive course builder* whose differentiator is the
seamless live ↔ self-paced bridge — so every roadmap item is judged against
"does this strengthen the blended-delivery moat or the curate-existing-content
workflow?" If not, it's out of scope.
