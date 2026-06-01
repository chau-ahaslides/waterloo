# Slide-type architecture

Lessons are a sequence of **slides**. Each slide has a `type` discriminator
naming a registered **slide-type module**. The architecture is *pluggable*: a
slide type is a fully self-contained module that owns how a raw AhaSlides
presenter slide becomes a lesson slide, how that slide is rendered in the
audience/preview view, and how (or whether) it captures a response. The generic
player, converter and converter-modal never reference a concrete slide type —
they talk only to the **registry** and the **contract**.

This was introduced in WAT-7 to replace the original pick-answer-only code so new
slide types can be added in parallel, independently tested, with **no edits to
the generic player/converter**.

## Files

```
src/slide-types/
  types.ts                 # the SlideTypeModule contract + BaseLessonSlide
  registry.ts              # registers modules; lookup + convert + score helpers
  registry.test.ts
  pickAnswer/              # first module — multiple-choice, has a response
    module.ts
    PickAnswerSlide.vue    # owns option buttons + correct/wrong feedback
    module.test.ts
  infoSlide/               # second module — INFO-ONLY, no response
    module.ts
    InfoSlide.vue          # titled content card + Continue button
    module.test.ts
```

Consumers of the registry (unchanged when adding a type):

- `src/lessons/lessons.ts` — `convertPresentationToLesson` runs every raw slide
  through `convertRawSlide`; the first registered module that claims it wins,
  unsupported slides are skipped.
- `src/views/LessonPlay.vue` — for each lesson slide it renders the registered
  `component` via `<component :is>` and wires the contract events; it tallies the
  score (response slides only) and shows the completion screen.
- `src/views/ConverterModal.vue` — generic copy ("supported slides"); no per-type
  logic.

## The contract (`SlideTypeModule`)

```ts
interface SlideTypeModule<TSlide extends BaseLessonSlide, TResponse> {
  type: string                       // discriminator, e.g. 'pickAnswer'
  hasResponse: boolean               // false = info-only (no answer captured)
  convert(raw: RawSlide): TSlide | null   // map raw presenter slide or null
  component: Component               // renders + receives its own response
  scoreFor?(slide: TSlide, response: TResponse): number  // response types only
}
```

Every lesson slide extends `BaseLessonSlide` (`{ id: number; type: string }`).

### Component props + emits

The player passes the same props to every slide-type component and listens for
both events; a module uses whichever fits:

| | props | emits |
| --- | --- | --- |
| Response type (`hasResponse: true`) | `slide`, `showingFeedback`, `response` | `answered` (payload = the response) |
| Info-only type (`hasResponse: false`) | `slide`, `showingFeedback`, `response` | `continue` (no payload) |

The player schedules the 800 ms auto-advance after `answered`; `continue`
advances immediately. The score denominator counts only `hasResponse` slides.

## Adding a new slide type

1. Create `src/slide-types/<name>/`:
   - `module.ts` implementing `SlideTypeModule` (`type`, `hasResponse`,
     `convert`, `component`, and `scoreFor` if it captures a response).
   - `<Name>Slide.vue` — renders the slide and emits `answered`/`continue`.
   - `module.test.ts` — convert logic + response/scoring + a component mount test.
2. Register it in `src/slide-types/registry.ts` by adding the module to
   `SLIDE_TYPE_MODULES` (one line).

Nothing in `LessonPlay.vue`, `lessons.ts` or `ConverterModal.vue` changes.

### Info-only example (`infoSlide`)

`infoSlide` maps an AhaSlides `freestyle` (content/heading) presenter slide into
a titled content card with a Continue button. It sets `hasResponse: false`,
omits `scoreFor`, and its component emits only `continue`. A blank `freestyle`
slide (no title/body/image) converts to `null` and is skipped, so lessons never
show an empty card.

## Source slide shapes (confirmed 2026-06-01 against the dev API)

`GET /api/presentation/detail/<id>` returns `Slides[]`. Relevant raw shapes:

- **pick-answer:** `type:'pickAnswer'`, `slideType` ∈ {`null` (classic MC),
  `'imageChoice'`} with a non-empty `SlideOptions[]` (`{id, title, correct, image}`).
  `typeAnswer`/`matchPairs`/`correctOrder`/`categorise` variants are skipped (no
  option-backed multiple choice).
- **info / content:** `type:'freestyle'`, with `title` (+ optional `subheading`,
  `bodyHTML`, `image`, `sanitizedTitle`). e.g. the "Discover Hanoi" deck (access
  code `2DEFH`, presentation `431816`) has freestyle slides "Historic Landmarks"
  and "Culinary Delights".
