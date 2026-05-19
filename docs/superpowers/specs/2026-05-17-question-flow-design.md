# Question Flow — Input-Replacement Design

**Date:** 2026-05-17  
**Status:** Approved

## Context

The current `AskOptions` component renders all clarifying questions at once as a card inside the AI message bubble. The new design replaces this with a one-at-a-time question card that takes over the input box area — matching the interaction pattern of Claude.ai.

---

## Approach

**Approach B — Sibling component swap.**  
`useChatSession` owns the question queue. `ChatSystem` renders either `<QuestionCard>` or `<ChatInput>` based on queue state. `QuestionCard` is a new focused component.

---

## Section 1 — State (`useChatSession`)

### New state fields

| Field | Type | Purpose |
|-------|------|---------|
| `pendingQuestions` | `Prompt[]` | Queue of unanswered questions. Populated from `evt.prompts` on WebSocket `end` event. |
| `promptSourceMessageId` | `string \| null` | The `messageId` of the AI message that owns the prompts. Needed by `answerPrompts()`. Set alongside `pendingQuestions`. |
| `totalQuestions` | `number` | Snapshot of the original queue length. Set once when `pendingQuestions` is first populated so the progress indicator stays accurate as questions are consumed. |
| `currentAnswers` | `{ [promptId]: string[] }` | Accumulated answers collected locally as user steps through the queue. |
| `awaitingReply` | `boolean` | True after all answers submitted, false when next agent `end` event arrives. Keeps input hidden while agent thinks. |

### New function

**`answerCurrent(promptId, labels)`**
1. Records `{ [promptId]: labels }` into `currentAnswers`
2. Removes the current question from the front of `pendingQuestions`
3. If `pendingQuestions` becomes empty:
   - Sets `awaitingReply = true`
   - Calls existing `answerPrompts(promptSourceMessageId, allAccumulatedAnswers)` — sends synthetic user reply, patches DB
4. `awaitingReply` is reset to `false` when the next WebSocket `end` event fires

### Removed

- `awaitingPromptAnswer` derived value — no longer needed (was used by old `ChatInput` awaiting bar)

---

## Section 2 — `QuestionCard` Component

**Files:** `frontend/src/pages/ChatSystem/QuestionCard.jsx` + `QuestionCard.module.css`

### Layout (top → bottom inside the floating shell)

```
┌──────────────────────────────────────────┐
│  [SKILL LEVEL]                    2 / 4  │  ← header chip + progress
│  What's your current skill level?        │  ← question text
│                                          │
│  ┌─────────────┐  ┌─────────────┐        │
│  │  Beginner   │  │ Intermediate│  ...   │  ← option cards
│  │ Never coded │  │ Some exp.   │        │
│  └─────────────┘  └─────────────┘        │
│                          [ CONTINUE → ]  │  ← only for multiSelect
└──────────────────────────────────────────┘
```

### Behaviour

- **Single-select** (`multiSelect: false`): clicking an option immediately calls `onAnswer` — no Continue button
- **Multi-select** (`multiSelect: true`): checkboxes, CONTINUE button appears after ≥1 selection, calls `onAnswer` on click
- **Animation**: current card fades + slides out left, next card slides in from right (CSS `transform + opacity`, 220ms)

### Styling

- Same frosted glass shell as `ChatInput`: `rgba(38,38,37,0.88)`, `backdrop-filter: blur(16px) saturate(140%)`, `border-radius: 10px`, `padding: 16px`
- Same floating position: `position: absolute; bottom: 16px; max-width: 660px; margin: 0 auto`
- Option cards: `background: var(--surface-code)`, `border: 1px solid transparent`, green border on hover/selected
- Selected state: green border + faint green background tint
- Progress: `var(--fg-4)` mono text, top-right

### Props

```ts
question:        Prompt        // current question object
questionIndex:   number        // 0-based index of current question
totalQuestions:  number        // total count for progress display
onAnswer:        (promptId: string, labels: string[]) => void
```

---

## Section 3 — `ChatSystem` Wiring

### Render logic (bottom of `.main`)

```jsx
{pendingQuestions.length > 0 ? (
  <QuestionCard
    question={pendingQuestions[0]}
    questionIndex={totalQuestions - pendingQuestions.length}
    totalQuestions={totalQuestions}
    onAnswer={answerCurrent}
  />
) : awaitingReply ? (
  null   // input hidden — agent is generating
) : (
  <ChatInput
    onSend={chat.send}
    onFileUpload={handleFileUpload}
  />
)}
```

`totalQuestions` comes directly from the hook state field of the same name — set once when `pendingQuestions` is first populated, never mutated as questions are consumed.

### `AskOptions` removal

- `AskOptions.jsx` and `AskOptions.module.css` are deleted
- `<AskOptions>` is removed from `AIMsg` in `ChatMessages.jsx`
- The `hasPrompts` render path in `AIMsg` is removed entirely
- Answered questions remain visible in chat via the existing synthetic user reply message
- `awaitingPromptAnswer` prop removed from `ChatInput` and its `awaitingBar` UI removed from `ChatInput.jsx` / `ChatInput.module.css`

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useChatSession.js` | Add `pendingQuestions`, `currentAnswers`, `awaitingReply`, `answerCurrent()` |
| `frontend/src/pages/ChatSystem/ChatSystem.jsx` | Swap render logic, pass new props, derive `totalQuestions` |
| `frontend/src/pages/ChatSystem/QuestionCard.jsx` | **New** — one-question-at-a-time card |
| `frontend/src/pages/ChatSystem/QuestionCard.module.css` | **New** — styles |
| `frontend/src/pages/ChatSystem/ChatMessages.jsx` | Remove `AskOptions` render from `AIMsg` |
| `frontend/src/pages/ChatSystem/ChatInput.jsx` | Remove `awaitingPromptAnswer` prop + `awaitingBar` UI |
| `frontend/src/pages/ChatSystem/ChatInput.module.css` | Remove `.awaitingBar`, `.awaitingText`, `.awaitingOverride` |
| `frontend/src/pages/ChatSystem/AskOptions.jsx` | **Deleted** |
| `frontend/src/pages/ChatSystem/AskOptions.module.css` | **Deleted** |

---

## Verification

1. Start frontend dev server
2. Open chat, send a message that triggers clarifying questions
3. Confirm: input box disappears, first question card appears in its place (floating, same position)
4. Answer a single-select question — confirm it auto-advances to next card with slide animation
5. Answer a multi-select question — confirm checkboxes + CONTINUE button, advances on click
6. Answer all questions — confirm card disappears, input box stays hidden
7. Wait for agent response — confirm input box reappears only after agent `end` event
8. Check chat history — confirm answered questions are visible as the synthetic user reply
9. Confirm no `AskOptions` card renders inside AI message bubbles
