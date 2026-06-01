# Lesson Editor — Requirements Proposal

> **Status: proposal — pending approval**
> **Date:** 2026-06-01
> **Project:** Waterloo (AhaSlides e-Learning frontend)
> **Task:** WAT-3
> **Author:** Paddington (underground-station team)

This document proposes the requirements for a **Lesson editor page** in Waterloo. It is grounded in eLearning industry standards (Articulate Rise/Storyline, Coursera/Teachable course builders, Moodle/Canvas authoring, and quiz authoring in Kahoot/Quizizz), and tied to the [Project AhaSlides e-Learning thesis](./PROJECT-THESIS.md) and to what the app actually does today.

**Nothing has been built.** This is a requirements proposal for review. Once scope is confirmed, a follow-up task can implement the agreed MVP.

---

## 0. TL;DR

- The editor is the **EDIT** step in the Waterloo flow: `home → convert → EDIT → publish/deliver`. After conversion produces a draft lesson from a presentation, the editor is where a trainer cleans it up and makes it deliverable.
- AhaSlides' advantage is that **the content already exists** — the editor is less about authoring from scratch and more about **curating, reordering, enriching, and quality-checking** a converted lesson.
- **Recommended MVP** (given the app today only handles pick-answer slides, localStorage, no backend): lesson metadata editing, slide list with reorder/add/remove/duplicate, a pick-answer slide editor (question + options + correct answer + per-slide feedback), a basic text/content slide type, a learner-view preview toggle, and autosave to localStorage. Everything else is a later phase.
- The biggest **open questions** are about the backend (lessons are localStorage-only today), the publish/draft model, and whether new non-quiz slide types belong in v1.

---

## 1. Purpose & scope

### 1.1 Where the editor sits in the Waterloo flow

```
Home ──▶ Convert ──▶  EDIT  ──▶ Publish / Deliver
(list)   (presentation   (this    (self-paced course;
         → draft lesson)  doc)     blended live↔async)
```

- **Convert** already exists (WAT-1): it pulls a presentation's *pick-answer* slides into a draft `Lesson` (see `src/lessons/lessons.ts`).
- **Edit** is the missing middle step. A converted lesson is rarely publish-ready: questions may need rewording, dead slides removed, ordering fixed, an intro/summary added, learning objectives set.
- **Publish / Deliver** is downstream and out of scope here, but the editor must produce a clean, valid lesson that the delivery step can consume.

### 1.2 What the editor is and is not

**Is:** a focused, opinionated tool for shaping a *converted* lesson into a deliverable self-paced unit. Per the thesis, AhaSlides is *"the simple, beautiful, interactive course builder for trainers"* — **not** a full LMS.

**Is not (per thesis "What We Are NOT Building"):** a full LMS, a course marketplace, a SCORM authoring suite, or a Storyline-grade freeform canvas. We deliberately stay simpler than Moodle/Canvas.

### 1.3 Primary user

A **trainer** (corporate trainer, educator, coach) who already built the source presentation. They are domain experts, not instructional-design specialists — the editor must be obvious without training.

---

## 2. Core content blocks / slide types

Industry editors offer a palette of block types. Mapping them to AhaSlides:

| Block / slide type | Industry precedent | AhaSlides mapping | Status |
| --- | --- | --- | --- |
| **Pick-answer quiz** (multiple choice, single/multi correct) | Kahoot, Quizizz, Rise quiz blocks | Existing AhaSlides "pick answer" slide; already converted (`LessonSlide`) | **Exists** |
| **Text / rich content** (heading, paragraph, list) | Rise text block, Teachable text lesson | New (lightweight rich text) | New |
| **Image** | Rise image block | AhaSlides slides carry images; option images already modeled (`LessonOption.image`) | Partial |
| **Video / embed** | Teachable/Coursera video lessons, Rise video block | New (URL/embed) | New |
| **Title / section divider** | Rise lesson cover, Coursera module header | New | New |
| **Other interactive** (poll, open-ended/Q&A, word cloud, slider, drag-order, hotspot) | AhaSlides live slide types; Kahoot/Quizizz variants | Map from existing AhaSlides slide types as the converter learns to import them | Later |
| **Knowledge check / graded quiz section** | Rise quiz, LMS assessment | Composition of pick-answer slides with scoring | Later |

**Key insight for the editor:** AhaSlides already has a rich library of interactive slide types live. The long-term editor's content palette should **converge with the AhaSlides slide-type catalogue**, not invent a parallel one. v1 only needs to *edit* what the converter currently produces (pick-answer) plus a minimal text block so trainers can add framing.

---

## 3. Structure & navigation editing

Standard course-builder structure controls:

### 3.1 Slide-level (within a lesson)
- **Reorder** slides — drag-and-drop (industry standard) with a keyboard-accessible fallback (move up/down).
- **Add** a slide — choose a type from the palette (§2).
- **Remove** a slide — with confirm + undo.
- **Duplicate** a slide — fast way to author similar questions.
- **Slide list / outline panel** — a left rail showing all slides with type icons and titles, the standard two-pane editor layout (Storyline, Rise, Quizizz).

### 3.2 Lesson-level metadata
Editable lesson properties (industry-standard course/lesson settings):
- **Title** (exists on `Lesson`)
- **Description / summary**
- **Cover image** (thumbnail used on Home)
- **Estimated duration** (auto-suggest from slide count; editable)
- **Learning objectives** (list — pedagogically standard; "by the end you will…")
- **Tags / category** (later — for a future library/search)

### 3.3 Sections / chapters
- Grouping slides into **sections/modules** is standard in Coursera/Teachable/Rise for longer content.
- **Recommendation:** defer to a later phase. A converted lesson from one presentation is usually short enough to be flat. Add sections when lessons grow or when multiple presentations merge into one lesson.

---

## 4. Quiz / assessment authoring

Pick-answer is the v1 content type, so this is the core of the MVP editor. Standard quiz-authoring capabilities (Kahoot/Quizizz/Rise):

- **Edit question text** (exists: `LessonSlide.question`).
- **Edit options** — add / remove / reorder / edit text; option images (model already has `LessonOption.image`).
- **Mark correct answer(s)** — single-correct radio and multi-correct checkbox (model: `LessonOption.isCorrect`, already a boolean per option, so multi-correct is representable).
- **Per-answer or per-question feedback** — explanatory text shown after answering ("Correct! Because…"). Standard in Rise/Quizizz; strongly improves self-paced learning. **New field.**
- **Scoring / points** — points per question; pass threshold for the lesson. **Recommend simple v1:** every question worth 1, optional pass %.
- **Shuffle** — randomize option order (and optionally question order). Standard anti-cheat / re-engagement feature. **New field.**
- **Required vs. optional** — must a learner answer to proceed? (later)
- **Attempts / retry** — single vs. unlimited attempts (later; tie to delivery).

**Validation** the editor must enforce before publish: every pick-answer slide has a question, ≥2 options, and ≥1 correct answer. Surface invalid slides in the outline.

---

## 5. Preview / learner-view toggle

- A **Preview** mode that renders the lesson exactly as a learner sees it (self-paced, step-through), without the editing chrome. Universal in Rise/Storyline/Teachable.
- Toggle between **Edit** and **Preview** in-page (no separate route needed for v1).
- Preview should let you actually answer questions and see feedback, so the trainer can QA the learner experience.
- **Later:** device-size preview (desktop/mobile), and a real shareable preview link.

---

## 6. Autosave, versioning, undo

- **Autosave** — debounced save on every change; a visible "Saved / Saving…" indicator. Expected in every modern editor. v1 saves to **localStorage** (current persistence layer); a real backend is an open question (§9).
- **Draft vs. published** — a lesson has a state. Edits happen on a **draft**; publishing creates the learner-facing version. **Recommendation:** model the `status` field now (`draft` | `published`) even if publish is a later phase, so we don't migrate later.
- **Undo / redo** — at minimum undo for destructive actions (delete slide/option). Full multi-step undo is a later nicety.
- **Versioning / revision history** — defer; not MVP for a single-author tool.

---

## 7. Accessibility & i18n

- **Keyboard accessible**: all editing actions reachable without a mouse; drag-reorder needs a keyboard fallback (move up/down buttons). WCAG 2.1 AA target.
- **Screen-reader labels** on all controls; correct ARIA for the slide list and dialogs. Ant Design Vue provides a baseline — verify, don't assume.
- **Contrast / focus states** per the AhaSlides design-token theme.
- **i18n-ready**: all editor chrome strings externalized (no hard-coded copy) so the UI can be localized. The lesson *content* is authored in the trainer's language; do not auto-translate.
- **Alt text** on images (cover, option images) — an editable field, both for accessibility and because learner content should be accessible too.

---

## 8. MVP vs. later phases

Opinionated split. Given the app today only handles pick-answer slides, persists to localStorage, and has no backend lessons API, the **smallest useful editor** is:

### ✅ v1 (MVP) — "make a converted lesson deliverable"
1. **Editor route** (e.g. `/lessons/:id/edit`) reachable from Home; loads a lesson from localStorage.
2. **Two-pane layout**: slide outline (left) + slide editor (right).
3. **Lesson metadata**: edit title, description, cover image, estimated duration, learning objectives.
4. **Slide list ops**: reorder (drag + keyboard fallback), add, remove (confirm + undo), duplicate.
5. **Pick-answer slide editor**: edit question, add/remove/reorder/edit options, set correct answer(s), per-question feedback text, shuffle toggle.
6. **One new simple slide type: Text/content** (heading + rich-ish text) so trainers can add intro/section/summary framing.
7. **Preview toggle**: in-page learner view that's actually answerable.
8. **Autosave** to localStorage with a Saved/Saving indicator.
9. **Validation**: flag invalid quiz slides; block a (future) publish until clean.
10. **`status` field** modeled as `draft`|`published` (even if publish UI lands later).

### 🔜 Phase 2 — "richer authoring"
- Image, video/embed, title-divider slide types.
- Sections / chapters.
- Simple scoring (points, pass %) and learner attempts settings.
- Undo/redo stack beyond single-action.
- Device-size preview.

### 🔭 Phase 3 — "platform"
- **Backend lessons API** + real persistence (replace localStorage) and multi-device sync.
- Converge the content palette with the **full AhaSlides slide-type catalogue** (poll, open-ended, word cloud, slider, etc.) as the converter learns to import them.
- Publish workflow + shareable learner links; draft/published versioning & revision history.
- Collaboration (multiple authors), comments.
- Ties into **progress dashboard** and **blended delivery** (the thesis moat).

---

## 9. Open questions / decisions to confirm before building

1. **Backend now or later?** Lessons are localStorage-only today. Do we build the MVP editor against localStorage (fastest, matches WAT-1) and migrate later, or stand up a lessons API/backend first? *Recommendation: localStorage for MVP, model the data cleanly so migration is mechanical.*
2. **New slide types in v1?** Is the single **Text/content** block enough for MVP, or do you want image/video in v1 too? *Recommendation: text only in v1.*
3. **Publish model.** Should v1 include an actual publish action + learner-facing route, or is "edit the draft" the whole MVP and publish/delivery is a separate task? *Recommendation: model `status` now, ship publish in a later task.*
4. **Single vs. multi-correct quizzes.** The model supports multiple correct options. Do we expose multi-correct in v1, or restrict to single-correct for simplicity? *Recommendation: support both; the model already allows it.*
5. **Scoring.** Does MVP need points/pass-threshold, or is the quiz purely formative (feedback only, no score) for v1? *Recommendation: formative-only in v1; scoring in Phase 2.*
6. **Sections/chapters.** Confirm flat-lesson is acceptable for v1. *Recommendation: yes, flat.*
7. **Editor entry point.** New route `/lessons/:id/edit`, or edit-in-place on Home? *Recommendation: dedicated route.*
8. **Editing vs. re-converting.** If the source presentation changes after conversion, does the editor offer a re-sync, or is a converted lesson a one-time snapshot? *Recommendation: one-time snapshot for v1; re-sync is a later feature.*

---

## 10. Summary

The lesson editor is the curation step that turns a converted draft into a deliverable self-paced lesson. Because AhaSlides starts with content that already exists, the editor's job is **shape and enrich, not author from scratch** — which is exactly why a tight, opinionated MVP (metadata + slide reorder/add/remove + pick-answer authoring + preview + autosave) delivers most of the value with little surface area. Richer slide types, a real backend, and the publish/blended-delivery workflow follow in later phases as the product grows into the thesis.
