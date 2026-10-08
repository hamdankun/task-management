# 07 — UI design

The interface is built with **shadcn/ui and Tailwind CSS v4**, which was the client's choice. I followed the `frontend-design` process: write the brief, make a design plan, review the plan against the generic defaults, revise it, build it, and then critique the result. This document ties back to the [PRD](01-PRD.md) (sections 8 and 11), the [tech spec](02-tech-spec.md) (section 5), the [folder structure](05-folder-structure.md) and the [security review](06-security-review.md).

## 1. The brief

- **The product** is a task manager whose point is *traceable change*: who moved what, and when.
- **Who uses it:** teammates who move tasks all day, and the occasional reviewer who opens the history to settle "who changed this?".
- **What they need to do:** see every task's status at a glance, move a task to its next status in one gesture, and read a history they can trust.
- **The feel:** calm and exact. It's a Trello-like board, but it keeps a logbook's discipline. The assessment doesn't grade looks, but clear status and a clear history *are* the product, so that's where the design effort went.

## 2. The design plan

### 2.1 The one memorable thing

**The record.** Task titles, descriptions and the activity ledger are set in a serif typeface on an otherwise Trello-like board, so what people wrote and what happened reads as a record, while the interface around it stays quiet. The activity ledger (a vertical line of who did what, oldest first) is the other half: it's where the product keeps its promise.

(The first version had a four-step "status track" on each row. The board's columns made it redundant, so it was removed.)

### 2.2 Colour tokens (light and dark)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `paper` (`--background`) | `#F4F6F8` | `#10151B` | The base fill for inputs inside dialogs (the app's own background is the canvas, section 2.5) |
| `surface` (`--card`, `--popover`) | `#FFFFFF` | `#171E26` | Cards, dialogs, inputs |
| `ink` (`--foreground`) | `#18212B` | `#E7ECF1` | Main text and the main button's fill |
| `muted` (`--muted-foreground`) | `#556270` | `#9AA7B5` | Secondary text and timestamps |
| `rule` (`--border`) | `#D3DAE2` | `#263140` | Decorative dividers |
| `control` (`--input`) | `#7A8796` | `#5B6878` | Borders of inputs and selects (at least 3:1 against the surface) |
| `focus` (`--ring`) | `#1A4FB8` | `#8DB4FF` | The focus ring |
| `danger` (`--destructive`) | text `#A12A22` on `#FDECEA` | `#FF9E94` on `#3F1C19` | Errors and delete |

The status colours. Each text-on-background pair was checked for at least 4.5:1 contrast, and colour is never the only signal, because the text label is always there.

| Status | Light (text / background) | Dark (text / background) | Meaning |
|---|---|---|---|
| `to_do` | `#475569` / `#EBEFF4` | `#B4C0CE` / `#263140` | Not started |
| `pending` | `#7A4E00` / `#FAEFD4` | `#F0C060` / `#3A2E10` | Waiting |
| `in_progress` | `#1A4FB8` / `#E3ECFD` | `#8DB4FF` / `#1B2E57` | Being worked on |
| `done` | `#17653F` / `#DDF2E6` | `#7DD3A0` / `#12372A` | Finished |

These are shadcn CSS variables (on `:root`, switching for dark mode), plus four extra sets, `--status-*-fg` and `--status-*-bg`, exposed through `@theme inline`. **Components never contain colour values**, only token classes such as `text-status-pending-fg` and `bg-card`.

### 2.3 Typography

One rule: **serif is the record, sans is the system.** Anything a person wrote, or that happened (task titles, descriptions, history sentences), is in the serif. The interface around it (labels, buttons, badges, timestamps, form controls) is in the sans. Each face has one clear job.

| Role | Typeface (self-hosted through Fontsource, variable fonts) | Size and weight |
|---|---|---|
| The record | **Source Serif 4** (`@fontsource-variable/source-serif-4`) | Card title 16/24, 600. Popup title 24/32, 600. Description and activity text 15/24, 400 (serif text gets extra line height) |
| The system | **Schibsted Grotesk** (`@fontsource-variable/schibsted-grotesk`) | App name 18/24, 700. Buttons and labels 14/20, 500. Badges 12/16, 600. Timestamps 13/20, 500, with tabular numbers |

- The scale is 12, 13, 14, 15, 17 and 18. There are no display sizes, because this is a tool and not a landing page. Everything is in sentence case, with no all-caps labels and no letter-spacing tricks.
- Line length: columns are 296 px wide, the popup's text pane is about 560 px at most, and activity sentences stay under about 70 characters a line.
- The fonts are bundled with the app, so there are no third-party requests, which fits the privacy and CSP choices (06, S-05 and S-22).

### 2.4 Shape, spacing and surfaces

- Corner radius follows the hierarchy instead of being one value everywhere: **columns `rounded-xl`, cards and dialogs `rounded-lg`, controls `rounded-md`, badges and avatars `rounded-full`.**
- Cards sit on light columns over the canvas. A card has a 1 px border and `shadow-sm`, a small and useful lift so a white card reads against a pale column, as in Trello. It gets `shadow-md` on hover and `shadow-xl` while being dragged. There are no other shadows and no gradients, except the canvas.
- Spacing follows a 4 px grid. Columns have 10 px of padding and cards 12 px. The page gutter is 16 px on mobile and 24 px on desktop.
- Everything is left-aligned, because a record reads down a left edge. Timestamps in the ledger sit on the right.

### 2.5 Canvas and chrome (version 3: "similar to Trello, but not the same")

The client asked for a Trello-like look. I took Trello's *structure* and kept our own identity.

| Borrowed from Trello | Our own version |
|---|---|
| A full-width coloured canvas behind light columns | An **ink-blue** gradient (`#1f3d63 → #2b5886 → #36709a`; dark mode `#0c1722 → #173549`). I chose it over Trello's teal-green, and it ties back to our ink colour. No photo backgrounds |
| A translucent dark top bar | **One** bar: the wordmark and a one-line purpose on the left, and the actor control (this product's "avatar menu") on the right. No search, no Create button, no board switcher and no bottom nav, because none of those features exist |
| Fixed-width light columns that scroll sideways (296 px), with the title on the left, a count on the right, and **each column as tall as its cards** | A status **dot** in the header. A valid drop column grows a "Drop here" slot while you drag, so even an empty column is easy to hit |
| White cards with a soft lift, small indicators and an avatar on the right | **Serif** card titles, a description icon and the assignee's initials. **No** coloured label bars, attachment badges or checklists, because they aren't part of our model |
| Quick actions that appear on hover | Icon buttons at the card's top right (move to next, delete). They show on hover **and on keyboard focus**, they're always visible on touch screens, and they're always in the accessibility tree |
| A "+ Add a card" row at the bottom | An "Add a task" row, only in the To do column |

The tokens are `--canvas-*`, `--chrome` (the translucent bar) and `--chrome-foreground`, `-muted`, `-control`, `-control-hover` and `-border`. Text on the bar is white or white at 86%, and both meet 4.5:1 against the darkest part of the gradient (axe confirms it in light and dark).

## 3. The plan, checked against the usual defaults before building

| My first instinct | Why I rejected it | What I did instead |
|---|---|---|
| The shadcn defaults (zinc greys, the same `rounded-lg` card everywhere) | It looks like a generic SaaS kit | Custom tokens, radius by hierarchy, one status colour language, serif for records |
| Warm cream paper, a serif display face and a clay accent | It's the look an AI produces by default, and it has nothing to do with this subject | Cool paper grey; serif only for *records*, with a stated rule |
| A near-black UI with one acid accent for "status" | The default dark-mode swagger | Dark mode is a faithful swap of the same tokens, and the status hues keep their meaning |
| A monospace face for timestamps and ids | A template giveaway | Tabular numbers in the sans, which aligns the digits without the costume |
| An all-caps label above "History" or the status names | Template decoration | Sentence-case labels, no eyebrows |
| An arrow on button text ("Move to In progress →") | Another template giveaway | Plain verbs on buttons. The arrow icon only appears where data goes *from → to* |
| Cards fading up on load, scroll effects | Generic motion | No page-load or scroll animation. Motion only answers an action (section 8) |
| A Kanban board | *(Version 1)* too much scope, and it hides the history | **Adopted in versions 2 and 3 at the client's request**, with the history moved into the card popup's Activity pane |

## 4. Layout (a Trello-style board)

The client asked for a Trello-like board with drag and drop, inline creation and a card popup. That replaced the original list layout. The design system underneath (tokens, the type rule, radius by hierarchy, the status colours) didn't change.

It's a single full-width page: the translucent top bar, then the board. The board has four fixed-width (296 px) columns, left-aligned like Trello's. When the window is narrower than the columns the board scrolls sideways *inside its own area*, and the page itself never scrolls sideways. On a wide screen the leftover space is just canvas.

```
Task log                                              Acting as  [👤 john.doe      ▾]
Who changed what, and when.                   Not authenticated. This name is recorded in the history.
─────────────────────────────────────────────────────────────────────────────────────────
┌ ● To do        1 ┐ ┌ ● Pending      0 ┐ ┌ ● In progress  1 ┐ ┌ ● Done         1 ┐
│ ┌──────────────┐ │ │ Nothing pending. │ │ ┌──────────────┐ │ │ ┌──────────────┐ │
│ │ Book venue ⇢✕│ │ │                  │ │ │ Prepare inv. │ │ │ │ Ship report… │ │
│ │ ☰          JS│ │ │                  │ │ │ ☰            │ │ │ │            ✕ │ │
│ └──────────────┘ │ │                  │ │ └──────────────┘ │ │ └──────────────┘ │
│ ＋ Add a task    │ └──────────────────┘ └──────────────────┘ └──────────────────┘
└──────────────────┘
        (⇢ ✕ are the quick actions that appear on hover or focus)
```

- Columns sit on the tinted `secondary` surface. Cards are white `card` surfaces with a 1 px border and a small shadow.
- The column header has a status-coloured dot, the label, and the count on the right. The dot is the only colour in the column's chrome, and the status is always written out as text as well.
- A card shows a serif title, then small indicators: an icon if it has a description, and the assignee's initials in a dark circle on the right. The **quick actions** (move to the next status, delete) are icon buttons at the top right, shown on hover or focus and always on touch screens. Cards use `cursor-grab`, and the card itself is the drag handle.
- **"Add a task" sits at the bottom of the To do column**, where Trello puts it, as a ghost button with a plus. Cards in a column are oldest first, so a new card lands directly above it.
- Only To do has the composer, because every task starts there (that's the start of the status flow, and its `created` entry says `to_do`).
- The top bar has the wordmark, a thin divider and the one-line purpose. The actor control is one unit (label, user icon, native select, its own chevron) with the "Not authenticated" line under it, in white on the bar.

### Drag and drop

- **With a mouse** you drag the card, and it needs 6 px of movement first, so clicking the card's buttons still works. **On touch** you press and hold for 200 ms, so a swipe still scrolls the board. The page auto-scrolls near the edges.
- **While you drag**, the dragged card dims where it was and a preview follows the pointer. The **valid** column (only the next status) gets a dashed outline, a "Drop here" slot, and a tint when you hover it. Every other column fades to 60%. **The column under the pointer decides the drop**, not how much the preview overlaps.
- **Dropping on the valid column** shows the card there at once (marked busy). A "Moved to …" message confirms it, and the server's answer settles it; if the server refuses, the card goes back and a banner says why. **Dropping anywhere else** sends nothing and a message explains why.
- **Ways to move a card without dragging** (WCAG 2.5.7): the "Move to …" icon button on any card that has a next step, and the Status dropdown in the popup, where only the next status can be chosen. Keyboard users never have to drag.

### The card popup (it opens on click, like the back of a Trello card)

```
┌──────────────────────────────────────────────┬───────────────────────────┐
│ Status  [In progress ▾]                   ✕  │ Activity                  │
│                                              │ ⊕ john.doe created the…   │
│ Prepare invoice            ← click to edit   │     2026-10-08 16:45      │
│                                              │ ⇄ john.doe moved it       │
│ Assignee   (👤) [ Unassigned           ▾ ]    │     [To do] → [Pending]   │
│                                              │ ✎ jane.smith renamed the… │
│ ☰ Description            [Unsaved changes]   │     “A” → “B”             │
│ ┌──────────────────────────────────────────┐ │                           │
│ │ …                                        │ │                           │
│ └──────────────────────────────────────────┘ │                           │
│ [Save]  Discard changes                      │                           │
│ Created … · Updated …                        │                           │
└──────────────────────────────────────────────┴───────────────────────────┘
```

- **Status** is a dropdown that looks like a coloured chip, as on a Trello card. All four statuses are listed so the whole flow is visible. The current one is selected, only the **next** one can be chosen, and the rest are disabled, because the brief says the status only follows the order. Once a task is done the dropdown is disabled. Choosing a status moves the task and writes the usual `status_changed` entry.
- The left pane is white (`card`) and the right pane is tinted (`muted`). The popup is at most `max-w-4xl` wide and scrolls inside itself at 90% of the screen height. On small screens the two panes stack, with Activity underneath.
- The **title** is serif, 24/32, 600, and looks like plain text. A hover tint tells you it can be edited, and editing swaps in an input of the same size. The **description** is serif 15/24. When it's empty it shows as a muted block that says "Add a more detailed description…".
- **Activity entries** have an icon on a thin rail, the actor, what happened, and the time on the right (with tabular numbers). A rename shows “old” → “new”. A description change shows *Before:* and *After:* (two lines each, clamped). An assignment names the user. The full sentence is the entry's accessible text.
- **Focus:** the popup takes focus when it opens and gives it back to the card when it closes. Escape cancels an edit in progress first, and only then closes the popup.

### On a phone (360 px)

The header stacks. The board scrolls sideways with snapping, and each column is 85% wide, so the next one peeks in. The popup fills the width, with the activity under the details. Touch targets are at least 40 px.

## 5. Components

### 5.1 shadcn/ui components used

They were added with `npx shadcn@latest add …` and copied into `src/components/ui/`.

| Component | Used for |
|---|---|
| `button` | Add a task, Save, Discard changes, the quick actions; variants default, outline, ghost, link and destructive |
| `input`, `textarea`, `label` | The inline title, the descriptions and the composer |
| `badge` | `StatusBadge`, with a tone per status from the tokens |
| `alert` | The error banner (`role="alert"`), which can be dismissed |
| `alert-dialog` | Confirming a delete (instead of `window.confirm`, which would block automated tests) |
| `dialog` | The card popup |
| `skeleton` | The loading state of the columns and the activity |
| `sonner` | Success messages and the explanation for a refused drop |
| A plain `<select>` styled with Tailwind | The actor picker, the assignee and the Status dropdown. It's the most accessible choice and easy to test, with no pointer-event workarounds |

Not used, on purpose: card, table, dropdown-menu, popover, tabs, a form library, a tooltip component (a native `title` does the job), and collapsible (the history now lives in the popup).

### 5.2 Our own components

| Component | What it does |
|---|---|
| `ActorSelect` | A native select with a user icon and its own chevron, plus the "not authenticated" line. It saves the choice through `useActor` |
| `Board` | `DndContext` with its sensors, the four columns, the drag preview and the popup. The drop rule comes from `dropDecision` |
| `BoardColumn` | A drop target labelled by its heading: the header, the cards, the "Drop here" or empty text, and a slot for the composer |
| `TaskCard` | A draggable list item. The title button opens the popup, and it shows the indicators and the quick actions |
| `InlineComposer` | An "Add a task" button that turns into a textarea (with an optional description). Enter adds and stays open, Escape or Cancel closes it, and focus returns to the button |
| `TaskDialog` | The popup: `StatusSelect`, `InlineTitle`, `AssigneeField`, `DescriptionEditor` and the activity |
| `StatusSelect` | A native select styled as a status chip. Only the next status can be chosen |
| `StatusBadge` | A `<Badge>` carrying `data-status`, with its label from `STATUS_LABEL` |
| `AuditLogPanel`, `AuditLogEntry` | The activity ledger (an `<ol>`): loading, empty and error states; each entry's icon, actor, summary and time, with the sentence from `formatAuditLog` as its accessible text |
| `UserAvatar` | Initials in a circle. It's decorative, because the name is always there as text too |
| `ErrorBanner` | The shadcn `Alert`, destructive variant |
| `ConfirmDelete` | An `AlertDialog` |

Icons come from `lucide-react` and are used sparingly (add, move, delete, edit, user, chevron, close). Each one has text or an accessible name.

### 5.3 The words used for statuses (one place, used everywhere)

`web/src/lib/status.ts` has `STATUS_LABEL = { to_do: 'To do', pending: 'Pending', in_progress: 'In progress', done: 'Done' }`. Column headings, buttons, badges, history and messages all use it. The API and database keep the raw values, and `data-status` carries the raw value so tests can use it.

## 6. Wording (plain, active, consistent; errors say what happened and what to do)

| Where | Text |
|---|---|
| App name | Task log |
| The actor label and note | "Acting as", and "Not authenticated. This name is recorded in the history." |
| Card quick action | An icon button whose name and tooltip are "Move to {next status}". There is none once the task is done |
| Activity when empty (shouldn't happen) | "No history recorded." |
| Composer | The button "Add a task", the placeholder "What needs doing?", "Add description", then "Add task" (or "Adding…") and Cancel |
| Popup | A hidden title "Task details", then "Status", "Assignee" (Unassigned), "Description" (the placeholder "Add a more detailed description…"), "Save" and "Discard changes", the hint "Unsaved changes", "Activity", the message "Saved", and for the read-only case "Choose who you are to edit this task." |
| A drop that isn't allowed | "Tasks move one step at a time. This one can go to {status}." or "Done tasks can't move." |
| A stale move that was refused | "This task was changed in another tab. The list was refreshed." |
| Empty columns | "Nothing waiting.", "Nothing pending.", "Nothing in progress." and "Nothing done yet." While dragging, a valid column says "Drop here" |
| Deleting | The button "Delete". The dialog title "Delete “{title}”?", the text "The task leaves the board. Its history is kept.", and the buttons **Cancel** and **Delete task** |
| No actor chosen | "Choose who you are to add or change tasks." |
| Messages | "Task added", "Moved to {status}" (it matches the button), "Task deleted" |
| Already in that status | "Already {status}. Nothing changed." |

The text for each error code comes from `ApiError.code`, and the raw server text is never shown for a 500:

| Code | What people see |
|---|---|
| `VALIDATION_ERROR` | Under the field, using the messages from the shared schemas: "Title is required", "Title must be 120 characters or fewer", "Title contains unsupported characters", "Description must be 1000 characters or fewer" or "Choose a listed user" |
| `INVALID_ACTOR` | "Choose who you are, then try again." |
| `TASK_NOT_FOUND` | "That task no longer exists. The list was refreshed." |
| `INVALID_TRANSITION` | "This task was changed in another tab. The list was refreshed." (we always reload) |
| `FORBIDDEN_HOST` or `ROUTE_NOT_FOUND` | "Can't reach the task service. Check the address and try again." |
| `NETWORK_ERROR` | "Can't reach the task service. Check your connection and try again.", with a Retry button |
| `INTERNAL_ERROR` | "Something went wrong on our side. Try again. (Ref: {requestId})" |

## 7. States

| Surface | Loading | Empty | Error | Success |
|---|---|---|---|---|
| The board | Four skeleton columns | Text in each column ("Nothing waiting." and so on) | An alert with Retry | The columns and cards |
| Activity | Two skeleton lines | "No history recorded." | An inline alert with Retry | The ledger |
| A card's quick action | A spinner and `aria-disabled` (so focus is kept); the card is marked busy and can't be dragged | None | A banner | A message |
| The composer | The button says "Adding…" and the fields are read-only | None | Inline field errors | It clears, and stays open and focused |
| The popup's fields | "Saving…" on Save, and the fields are read-only | None | Inline errors for the title and description, otherwise a banner | A "Saved" message |

## 8. Motion (only what answers an action, and all of it off when the user prefers reduced motion)

1. **Moving a card:** it appears in its target column at once (the optimistic placement), and then the server confirms it or puts it back. There's no animation; the change of position is the feedback.
2. **Dragging:** the dragged card dims where it was, the preview follows the pointer and is tilted 2°, and the valid column gets a dashed outline.
3. **The popup and dialogs:** a fade and zoom in and out from Radix, about 150 ms.
4. **A card's quick actions:** a quick fade of their opacity on hover or focus.
5. **Messages:** Sonner's default enter and exit.

There's no animation when the page loads and none on scroll. Hovering a card only changes its border and shadow.

## 9. Accessibility (the quality floor)

- Contrast: all text and status pairs reach at least 4.5:1, and input borders and the focus ring at least 3:1, in both themes (checked with numbers, section 2.2, and with axe in the browser).
- Keyboard focus is always visible: a 2 px ring with a 2 px offset on every interactive element, and it's never removed.
- Structure: there's a `<header>` and a `<main>`. The board is a labelled region of four sections, each named by its heading, and the cards are items of a `<ul>`. The ledger is an `<ol>`, since chronological order carries meaning. The popup is a labelled dialog.
- Status is the column heading's text plus `data-status`, never colour alone. The status dot is decorative (`aria-hidden`).
- Icon buttons name their object: `aria-label` "Move to Done: Prepare invoice" and "Delete Prepare invoice", plus a tooltip. The popup's Status dropdown has a visible "Status" label.
- Errors use `role="alert"`, messages use Sonner's polite live region, and focus moves into a dialog when it opens and back to what opened it when it closes (Radix does this).
- The quick actions are revealed by hover **and** by keyboard focus, and are always visible on touch screens, so nothing depends on hover alone. A card can also be moved from the popup's Status dropdown, and every drag has a non-drag alternative.
- The app respects `prefers-reduced-motion` and `prefers-color-scheme`. Dark mode follows the operating system, and there's no toggle.
- At 360 px wide and at 200% zoom the page doesn't scroll sideways; the board scrolls inside itself.

## 10. Tailwind v4 and shadcn setup

| Item | Decision |
|---|---|
| Versions (npm, 2026-10-08) | `tailwindcss` and `@tailwindcss/vite` 4.3, shadcn CLI 4.21, `radix-ui` 1.7, `lucide-react` 1.53, `class-variance-authority` 0.7, `clsx` 2.1, `tailwind-merge` 3.7, `tw-animate-css` 1.4, `sonner` 2.0, `@fontsource-variable/source-serif-4` and `@fontsource-variable/schibsted-grotesk` 5.3. Re-check them when you scaffold again |
| Build | The `@tailwindcss/vite` plugin in `vite.config.ts`. There is **no** `tailwind.config.js` and **no** PostCSS config, because v4 is configured in CSS |
| The CSS entry | `src/index.css` imports `tailwindcss` and `tw-animate-css` plus the fonts. The light tokens are on `:root`, with dark overrides in `@media (prefers-color-scheme: dark)`, and `@theme inline { … }` maps the tokens to Tailwind colour names. shadcn's generated `@custom-variant dark (&:is(.dark *))` was **changed** to `@custom-variant dark (@media (prefers-color-scheme: dark))`, so `dark:` classes follow the operating system and no class toggle is needed |
| shadcn setup | `components.json` (style `new-york`, base colour neutral and then overridden by our tokens, css `src/index.css`, aliases `@/components`, `@/lib` and `@/components/ui`) |
| The `@/` alias | `@/` points at `apps/web/src` (a Vite `resolve.alias` and a `tsconfig` `paths` entry). It's **only allowed inside `apps/web`** |
| Copied-in code | `src/components/ui/*` is source we own. It's committed, left out of Prettier and of coverage, and still type-checked and linted for the security rules. It was reviewed once after generation, because it's part of the supply chain (06, S-13) |
| `cn()` | `src/lib/utils.ts` (`clsx` plus `tailwind-merge`) is the only helper for merging class names |
| Dark mode | The tokens switch on `prefers-color-scheme`, with no JavaScript |
| Security | No CDN fonts or scripts, no inline `style` attributes except those Radix generates, and ESLint bans `dangerouslySetInnerHTML` |
| Tests | The Vitest `web` project aliases `@/`. The jsdom stand-ins (`ResizeObserver`, `matchMedia`, `scrollIntoView`, pointer capture) are in `src/test/setup.ts` |

## 11. How the design was built and critiqued

1. Generate the tokens and the shadcn components, and exercise every state (loading, empty, error, a populated board, the popup, the composer, the delete dialog) through the Playwright visual spec.
2. Take screenshots with Playwright at **360, 768 and 1280 px, in light and dark**, and review them against section 3 ("does any part look like the default?") and section 9.
3. Take one accessory off before calling it done: cut any decoration that doesn't carry information.
4. Design changes are recorded in section 13 and in `08-implementation-plan.md`.

## 12. When is the UI done?

- [x] Every PRD user story, US-1 to US-9, can be done in the UI as designed (covered by `App.test.tsx` and the Playwright tests).
- [x] No component contains a hard-coded colour. Everything comes from tokens, and dark mode was checked in screenshots.
- [x] The axe accessibility checks pass for the main states.
- [x] At 360 px there's no horizontal scrolling of the page, and touch targets are at least 40 px.
- [x] The wording matches section 6, with one vocabulary (`STATUS_LABEL`) throughout the UI.
- [x] With reduced motion on, nothing animates.

## 13. How this differs from the original (list) design

- A Kanban board was adopted at the client's request.
- The history moved from an inline expandable section into the popup's Activity pane.
- The status track was dropped, because the column *is* the status.
- The "Add task" form became the inline composer.
- A card's description text moved off the card and into the popup (the card shows an icon).
- Editing, assigning and drag and drop were added.
- The corner-radius rule, the type rule, the motion rule and the accessibility floor didn't change.
