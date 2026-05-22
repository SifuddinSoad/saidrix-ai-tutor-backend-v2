# Lecture Loading Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic spinner/progress-bar lecture loading screen with a restrained, professional "watch it build" view that names the real topic, shows the real section outline, and reflects real enrichment progress.

**Architecture:** Pure presentation rewrite of the existing `/live` orchestration page. The generate → poll-job → fetch-lecture → poll-enrichment → navigate flow is preserved; only what's rendered changes. Two small pure helpers derive the section list and per-row states from real backend data. The topic title is passed from `CourseDetail` via router state, with a fallback to the generated lecture's own title.

**Tech Stack:** React 19, react-router-dom v7, CSS Modules, Vite. **No test runner exists in `frontend/`** — verification is via `npm run lint`, `npm run build`, and in-browser checks against the running dev server. Do **not** add a test framework.

**Spec:** `docs/superpowers/specs/2026-05-22-lecture-loading-screen-design.md`

---

## File Structure

- **Modify** `frontend/src/pages/Dashboard/CourseDetail/CourseDetail.jsx` — pass the known `topic_name` into the `/live` navigation as router state.
- **Modify** `frontend/src/pages/Live/Live.jsx` — add two pure helpers, track `topicTitle` / `sections` / enrichment counts in state, fetch the full lecture after generation, and replace the JSX render. Orchestration logic unchanged.
- **Modify** `frontend/src/pages/Live/Live.module.css` — replace the spinner/flow-bar/phases styles with header chip, topic block, section rows (done/now/upcoming), hairline progress line, and a `prefers-reduced-motion` block.

All section-list markup stays local to `Live.jsx` (the file remains ~250 lines, single responsibility). No new shared component.

---

## Task 1: Pass the real topic title from CourseDetail

**Files:**
- Modify: `frontend/src/pages/Dashboard/CourseDetail/CourseDetail.jsx` (the `joinClass` function, ~lines 123-132)

The roadmap step already carries `tp.topic_name` as `step.title`. `joinClass(loc)` is called from the lesson rows; pass the title alongside the location so the loading screen can show it during phase 1 (before the lecture object exists).

- [ ] **Step 1: Locate the call sites of `joinClass`**

Run a search to see how `joinClass` is invoked and whether the title is in scope at each call site:

```bash
grep -n "joinClass" frontend/src/pages/Dashboard/CourseDetail/CourseDetail.jsx
```

Expected: a definition around line 123 and one or more call sites passing a `loc`/step object.

- [ ] **Step 2: Change `joinClass` to accept and forward the title**

Replace the existing `joinClass` definition:

```jsx
  const joinClass = (loc) => {
    const qs = new URLSearchParams({
      courseId,
      chapter_index: String(loc.chapter),
      module_index: String(loc.module),
      sub_module_index: String(loc.sub_module),
      topic_index: String(loc.topic),
    });
    navigate(`/live?${qs}`);
  };
```

with a version that also forwards an optional title via router state:

```jsx
  const joinClass = (loc, topicTitle) => {
    const qs = new URLSearchParams({
      courseId,
      chapter_index: String(loc.chapter),
      module_index: String(loc.module),
      sub_module_index: String(loc.sub_module),
      topic_index: String(loc.topic),
    });
    navigate(`/live?${qs}`, { state: { topicTitle: topicTitle || '' } });
  };
```

- [ ] **Step 3: Pass the title at each call site**

For every call to `joinClass(step.loc)` (or `joinClass(currentStep.loc)`, etc.), add the step's title as the second argument, e.g. `joinClass(step.loc, step.title)` and `joinClass(currentStep.loc, currentStep.title)`. Use the variable that holds the roadmap step at that call site (its `.title` is `tp.topic_name`).

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new errors for `CourseDetail.jsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/CourseDetail/CourseDetail.jsx
git commit -m "feat(course): pass topic title into live loading screen via router state"
```

---

## Task 2: Add pure helpers + state wiring in Live.jsx

**Files:**
- Modify: `frontend/src/pages/Live/Live.jsx`

Add two pure module-level helpers and the state/effect wiring that feeds the new render. The render itself is replaced in Task 3.

- [ ] **Step 1: Import `useLocation` and the lecture fetch**

In the imports at the top of `Live.jsx`, add `useLocation` to the router import and `getLecture` to the live-api import:

```jsx
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
```

```jsx
import {
  generateLecture,
  getLectureJob,
  getLecture,
  getEnrichmentStatus,
  pollUntil,
} from '../../api/live';
```

- [ ] **Step 2: Add the two pure helpers above the component**

Insert below the existing `PHASES` constant (the `PHASES` array is no longer rendered but may stay; it is removed in Task 3). Add:

```jsx
// Section titles from a generated lecture's heading blocks. Mirrors the
// roadmap derivation used by LiveClassroom.
function deriveSections(lecture) {
  const blocks = lecture?.blocks || [];
  const titles = [];
  blocks.forEach((b) => {
    if (b?.type === 'heading') {
      const t = b?.data?.content || b?.text;
      if (t) titles.push(String(t).slice(0, 80));
    }
  });
  if (titles.length === 0 && lecture?.title) return [String(lecture.title)];
  return titles;
}

// Per-row state from real enrichment counts. Enrichment 'ready/total' is a
// segment count (not per-section), so row states are an honest approximation;
// the footer 'ready/total' number is the exact truth. `allDone` forces every
// row complete for the connect phase.
function sectionStates(count, ready, total, allDone) {
  if (count <= 0) return [];
  if (allDone) return Array.from({ length: count }, () => 'done');
  const ratio = total > 0 ? ready / total : 0;
  const doneCount = Math.min(count, Math.round(ratio * count));
  return Array.from({ length: count }, (_, i) =>
    i < doneCount ? 'done' : i === doneCount ? 'now' : 'todo'
  );
}
```

- [ ] **Step 3: Read the router-state title and add new state**

Just after `const [params] = useSearchParams();` add:

```jsx
  const routerLocation = useLocation();
  const navTitle = routerLocation.state?.topicTitle || '';
```

With the other `useState` declarations (near `phase`/`message`/`percent`), add:

```jsx
  const [topicTitle, setTopicTitle] = useState(navTitle);
  const [sections, setSections] = useState([]); // string[]
  const [enrich, setEnrich] = useState({ ready: 0, total: 0 });
```

- [ ] **Step 4: Populate sections + title after generation, and counts during enrichment**

In the async effect, after the generation job completes and `lectureId` is known (right after the existing `if (!lectureId) throw ...` line, before "Phase 2"), fetch the full lecture and derive sections:

```jsx
        // Pull the full lecture so we can show its real section outline.
        const full = await getLecture(lectureId).catch(() => job.lecture || null);
        if (!aliveRef.current) return;
        if (full?.title) setTopicTitle((t) => t || String(full.title));
        setSections(deriveSections(full));
```

Inside the enrichment `pollUntil` callback, alongside the existing `setPercent`/`setMessage`, record the real counts:

```jsx
              if (s?.total > 0) {
                setEnrich({ ready: s.ready || 0, total: s.total || 0 });
                setPercent(Math.min(60 + (s.ready / s.total) * 32, 92));
                setMessage(`Voice ready for ${s.ready}/${s.total} sections…`);
              }
```

(If a `getEnrichmentStatus` fast-path `initialStatus` is already ready, also set `setEnrich({ ready: initialStatus.total, total: initialStatus.total })` so the count shows complete.)

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: no new errors (note: `PHASES` may now be unused until Task 3 removes it — that is expected and resolved in Task 3; if lint blocks on it, proceed to Task 3 before re-linting).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Live/Live.jsx
git commit -m "feat(live): derive section outline + enrichment counts for loading screen"
```

---

## Task 3: Replace the Live.jsx render

**Files:**
- Modify: `frontend/src/pages/Live/Live.jsx`

Replace the returned JSX (both the error branch and the main branch) with the new layout. Remove the now-unused `PHASES` constant and the `activeIdx` line.

- [ ] **Step 1: Remove `PHASES` and `activeIdx`**

Delete the `const PHASES = [ ... ];` block near the top and the `const activeIdx = PHASES.findIndex(...)` line above the `return`.

- [ ] **Step 2: Compute render-time values before the return**

Above the `if (error)` block, add:

```jsx
  const displayTitle = topicTitle || 'Your lecture';
  const states = sectionStates(
    sections.length,
    enrich.ready,
    enrich.total,
    phase === 'connecting'
  );
  const statusLabel = phase === 'connecting' ? 'OPENING' : 'PREPARING';
  const showCount = enrich.total > 0;
  const pct = Math.min(Math.max(percent, 4), 100);
```

- [ ] **Step 3: Replace the error branch**

Replace the existing `if (error) { return ( ... ); }` with:

```jsx
  if (error) {
    return (
      <div className={`${styles.root} sx-grid`}>
        <div className={styles.panel}>
          <div className={styles.head}>
            <SaidrixMark size={30} withWord />
          </div>
          <p className={styles.error}>{error}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => navigate('/')}
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Replace the main return**

Replace the entire main `return ( ... );` with:

```jsx
  return (
    <div className={`${styles.root} sx-grid`}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <SaidrixMark size={30} withWord />
          <span className={styles.status}>
            <span className={styles.live} aria-hidden />
            <MonoLabel size={10} tracking="0.16em" color="var(--fg-3)">
              {statusLabel}
            </MonoLabel>
          </span>
        </div>

        <div className={styles.topicWrap}>
          <MonoLabel size={10} tracking="0.2em" color="var(--fg-4)">
            YOUR LIVE LECTURE
          </MonoLabel>
          <h1 className={styles.topic}>{displayTitle}</h1>
        </div>

        {sections.length === 0 ? (
          <p className={styles.composing}>{message}</p>
        ) : (
          <div className={styles.list}>
            {sections.map((title, i) => {
              const st = states[i];
              return (
                <div
                  key={`${i}-${title}`}
                  className={`${styles.seg} ${
                    st === 'done'
                      ? styles.segDone
                      : st === 'now'
                      ? styles.segNow
                      : ''
                  }`}
                >
                  {st === 'done' ? (
                    <span className={styles.ck}>✓</span>
                  ) : st === 'now' ? (
                    <span className={styles.spin} aria-hidden />
                  ) : (
                    <span className={styles.num}>{i + 1}</span>
                  )}
                  <span className={styles.segLabel}>{title}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.foot}>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.cap}>
            <span>{message}</span>
            {showCount && (
              <span className={styles.count}>
                {enrich.ready} / {enrich.total} ready
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 5: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: lint clean, build succeeds. If lint flags an unused import (e.g. a now-unused symbol), remove it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Live/Live.jsx
git commit -m "feat(live): render watch-it-build loading screen"
```

---

## Task 4: Replace Live.module.css

**Files:**
- Modify: `frontend/src/pages/Live/Live.module.css`

Replace the spinner / flow-bar / phases styles. Keep `.root`, `.panel`, `.error`, `.retry` (adjust as below). Add header chip, topic block, section rows, hairline bar, reduced-motion.

- [ ] **Step 1: Replace the file contents**

Replace the whole file with:

```css
.root {
  min-height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas);
  padding: 24px;
}

.panel {
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 34px;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  padding: 40px 36px;
}

/* header: brand lockup + status chip */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.live {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: sx-blink 1.6s ease-in-out infinite;
}
@keyframes sx-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

/* topic */
.topicWrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.topic {
  font-size: clamp(1.25rem, 3.5vw, 1.55rem);
  font-weight: 700;
  line-height: 1.25;
  color: var(--fg-1);
  margin: 0;
}

/* phase-1 status line (before the outline exists) */
.composing {
  color: var(--fg-3);
  font-size: 0.9rem;
  padding: 13px 2px;
  border-top: 1px solid var(--border-1);
  border-bottom: 1px solid var(--border-1);
  animation: sx-msgPulse 1.8s ease-in-out infinite;
}
@keyframes sx-msgPulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}

/* section list — hairline rows, no boxes */
.list {
  display: flex;
  flex-direction: column;
}
.seg {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 2px;
  border-top: 1px solid var(--border-1);
  font-size: 0.92rem;
  color: var(--fg-4);
  transition: color 0.3s ease;
}
.seg:last-child {
  border-bottom: 1px solid var(--border-1);
}
.segLabel {
  flex: 1;
}
.segDone {
  color: var(--fg-2);
}
.segNow {
  color: var(--fg-1);
}

.ck {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--green);
  border: 1.5px solid var(--green);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--fg-on-green);
}
.num {
  width: 17px;
  flex-shrink: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-4);
}
.spin {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--surface-3);
  border-top-color: var(--green);
  animation: sx-spin 0.8s linear infinite;
}
@keyframes sx-spin {
  to { transform: rotate(360deg); }
}

/* footer: hairline progress + caption */
.foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bar {
  height: 2px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
}
.barFill {
  height: 100%;
  background: var(--green);
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
.cap {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--fg-3);
}
.count {
  color: var(--fg-4);
  white-space: nowrap;
}

/* error */
.error {
  color: var(--danger);
  font-size: 0.95rem;
  line-height: 1.6;
}
.retry {
  align-self: flex-start;
  background: var(--green);
  color: var(--fg-on-green);
  font-weight: 600;
  border: none;
  padding: 12px 24px;
  cursor: pointer;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
}
.retry:hover {
  background: var(--green-bright);
}

/* respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .live, .composing, .spin, .barFill {
    animation: none;
    transition: none;
  }
  .spin {
    border-top-color: var(--green);
  }
}
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds (CSS module classes referenced in `Live.jsx` all resolve).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Live/Live.module.css
git commit -m "style(live): simple professional loading screen styles"
```

---

## Task 5: Browser verification

**Files:** none (verification only)

Verify the real behavior end to end against the running app. The repo has no test runner, so this is the correctness gate.

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm run dev`
Expected: Vite serves the app (note the local URL).

- [ ] **Step 2: Trigger a real lecture generation**

From a course in the dashboard, start a lesson so it navigates to `/live?courseId=...`. (Backend must be running on `VITE_API_BASE`.)

- [ ] **Step 3: Verify phase 1 (generating)**

Confirm: the SAIDRIX logo lockup shows top-left; a blinking green dot + `PREPARING` top-right; the eyebrow `YOUR LIVE LECTURE`; the **real topic title** (from CourseDetail); a single "Composing/Researching…" status line where the list will appear; the hairline bar advances. No section rows yet.

- [ ] **Step 4: Verify phase 2 (enriching)**

Confirm: the **real section outline** appears; completed rows show a green check; exactly one in-progress row shows the **spinning circle**; upcoming rows show muted numbers; the footer caption shows the exact `X / Y ready` count and it climbs as enrichment proceeds.

- [ ] **Step 5: Verify phase 3 + handoff**

Confirm: near the end all rows are checked, the chip reads `OPENING`, and the page navigates to `/live-classroom/:lectureId` without error.

- [ ] **Step 6: Verify deep-link fallback**

Open `/live?courseId=...&chapter_index=0&...` directly (no router state). Confirm the title is absent at first, then fills in from the generated lecture's own title once generation completes. No crash.

- [ ] **Step 7: Verify error + reduced motion**

Visit `/live` with no `courseId` → confirm the restyled error panel ("No courseId provided." + Back to home). With OS "reduce motion" enabled, confirm the spinner/dot are static.

- [ ] **Step 8: Final lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: both clean.

---

## Self-Review Notes

- **Spec coverage:** logo preserved (Task 3 uses `SaidrixMark`); real topic title (Tasks 1–2); section outline from headings (Task 2 `deriveSections`); spinning in-progress row (Tasks 3–4); exact `X/Y` footer count (Tasks 2–3); simple/professional styling + single accent + hairline dividers (Task 4); `prefers-reduced-motion` (Task 4); phase-1 pre-outline state (Task 3 `composing` branch); error state preserved (Task 3); no backend/LiveKit/`LiveClassroom`/demo-route changes (orchestration untouched).
- **Approximation:** `sectionStates` row states are approximate per the spec; footer count is exact. Documented in the helper's comment.
- **Type consistency:** `deriveSections` → `string[]`; `sectionStates(count, ready, total, allDone)` → `('done'|'now'|'todo')[]`; `enrich` is `{ ready, total }` everywhere; class names used in `Live.jsx` (`head`, `status`, `live`, `topicWrap`, `topic`, `composing`, `list`, `seg`, `segDone`, `segNow`, `ck`, `num`, `spin`, `segLabel`, `foot`, `bar`, `barFill`, `cap`, `count`, `error`, `retry`) all defined in Task 4 CSS.
