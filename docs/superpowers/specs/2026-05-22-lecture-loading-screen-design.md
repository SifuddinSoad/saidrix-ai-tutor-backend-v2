# Lecture Loading Screen Redesign — Design

**Date:** 2026-05-22
**Page:** `frontend/src/pages/Live/Live.jsx` (+ `Live.module.css`)
**Status:** Approved design, ready for implementation plan

## Problem

The screen shown while a course lecture is generated (`/live?courseId=...`) feels
**fake and boring**:

- A generic orbital spinner + a shimmering progress bar that animates regardless of
  real progress — it reads as theater, not actual work.
- A generic "Course lecture" heading that never names what's being built.
- A 3-phase checklist of internal pipeline stages ("Writing your lecture", "Preparing
  the voice", "Joining the live room") that means little to a student.

The brand logo (`SaidrixMark` = `logo.png` + SAIDRIX / AI TUTOR wordmark) is correct and
**must be preserved exactly**.

## Goal

A **simple, professional** loading screen where everything on screen maps to real
backend signals, turning the wait into watching the actual lecture take shape.

## Design Direction: "Watch it build" (simplified)

The wait becomes the show. Once the lecture is generated, its **real section outline**
appears, and each row resolves as its voice is prepared. Restrained styling: thin
dividers, generous whitespace, a single green accent, one piece of motion at a time.

### Layout (top → bottom)

1. **Header row**
   - Left: the real `SaidrixMark` lockup (logo + SAIDRIX / AI TUTOR), unchanged.
   - Right: a small mono status chip — a blinking green dot + `PREPARING`.
2. **Topic block**
   - Eyebrow: `YOUR LIVE LECTURE` (mono, muted).
   - Title: the **real topic name** (e.g., "Promises & async/await").
3. **Section list** — clean rows, thin top/bottom dividers, no boxes:
   - **Done** row: solid green circle with a `✓`, text in `--fg-2`.
   - **In-progress** row: a **small spinning circle** (green arc on a faint track),
     text in `--fg-1`.
   - **Upcoming** row: a muted mono index number, text in `--fg-4`.
4. **Footer**
   - A hairline 2px progress line (solid green fill, eased width transition — no
     shimmer/sweep).
   - Caption row: left = current backend message; right = exact `X / Y ready` count.

### Visual rules (the "professional" constraint)

- One accent color (`--green`); no glow stacks, no multi-ring spinners, no breathing logo.
- Exactly one moving thing per state (the active row's spinner + the status dot).
- Generous spacing; hairline dividers instead of cards.
- Honor `prefers-reduced-motion`: disable the spinner/blink, show a static dot/arc.

## State Machine (driven by the existing orchestration)

The orchestration logic in `Live.jsx` already runs three phases. The redesign changes
**presentation only** — the generate → poll-job → poll-enrichment → navigate flow stays.

| Phase | Backend signal | What the screen shows |
|-------|----------------|------------------------|
| **1. Generating** (no outline yet) | job `progress.message` cycles "Researching topic…" → "Composing lecture content…" → "Saving lecture…"; `percent` 10→100 (mapped to 8–54%) | Header + topic title + a single slim status line ("Composing your lecture…") where the list will appear. Progress line tracks mapped job percent. Section list not yet shown. |
| **2. Enriching** | enrichment status `{ ready, total, isReady }` | Section outline (from the generated lecture's headings) is now rendered. Rows fill progressively; the active row spins. Footer caption = "Preparing the voice…", right = exact `ready / total`. Bar mapped 60–92%. |
| **3. Connecting** | — | All rows checked; caption "Opening the live classroom…"; bar ~98%. Then `navigate('/live-classroom/:lectureId')`. |

### Data sources (all real)

- **Topic title:** passed from `CourseDetail.joinClass()` into the `/live` navigation as
  router state (`{ topicTitle }`) using the already-known `tp.topic_name`. Fallback for
  deep links without state: show the eyebrow only until the generated lecture object
  (which carries a `title`) arrives, then use that.
- **Section outline:** derived from the generated lecture's `blocks` of `type === 'heading'`
  (same derivation `LiveClassroom` uses for its roadmap). Available on the completed job's
  `lecture` object.
- **Per-section progress:** enrichment `ready` / `total` are **segment** counts, not
  per-section. The footer `X / Y ready` count is exact. Row states are an honest
  approximation: mark `round((ready / total) * sectionCount)` rows done, the next row
  spinning, the rest upcoming. (Documented as approximate at the row level; the footer
  number is the precise truth.)

## Error State

Preserve the existing error path (logo + message + "Back to home"), restyled to match the
new panel (same header lockup, restrained spacing). No behavior change.

## Scope

**In scope**
- Rewrite the presentation of `Live.jsx` and `Live.module.css` per above.
- Add the section-list rendering (derived from lecture headings + enrichment counts).
- One-line change in `CourseDetail.joinClass()` to pass `topicTitle` via router state.
- `prefers-reduced-motion` handling.

**Out of scope (YAGNI)**
- No change to the generation / enrichment / LiveKit handoff logic.
- No backend changes (no new per-section enrichment endpoint).
- No change to `SaidrixMark`, the demo `/classroom` route, or `LiveClassroom`.
- No "did you know" / educational filler content.

## Components / Files

- `frontend/src/pages/Live/Live.jsx` — keep orchestration; replace the JSX render. If the
  section list adds notable markup, extract a small presentational `SectionList` block
  within the same file (kept local; no new shared component unless it earns its place).
- `frontend/src/pages/Live/Live.module.css` — replace spinner/bar/phases styles with the
  header chip, topic block, section rows (done/now/upcoming), hairline bar, reduced-motion.
- `frontend/src/pages/Dashboard/CourseDetail/CourseDetail.jsx` — pass `topicTitle` in the
  `/live` navigation state.

## Success Criteria

- The real `SaidrixMark` logo is unchanged.
- The screen names the real topic and shows the real section outline.
- The in-progress section shows a spinning circle; done sections show a green check.
- The footer shows the exact `X / Y ready` enrichment count.
- Styling reads simple/professional: one accent, hairline dividers, single motion per state.
- `prefers-reduced-motion` users get a static, non-animated version.
- No regression to generation, enrichment, or the handoff to `/live-classroom/:lectureId`.
