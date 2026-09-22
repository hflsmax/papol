# One way to wait

Whenever Papol makes someone wait, the wait is shown one of two ways, and
only these two. Both are React components in `shared/ui/Waiting.js`, with
their styles beside `.spinner` in `shared/commonStyles.js` (so every app,
and the desktop app that wraps them, draws them the same) and the numbers
they show formatted by `shared/waiting.js`.

## The two components

**`Progress`** is a wait that can be measured. A thin bar — the accent on
the muted track, the height of a hairline rule, rounded — with the label
on the left and the numbers on the right, in the secondary text size and
colour the app already uses.

```jsx
<Progress fraction={0.4} label="Uploading" detail="12 MB of 30 MB" />
```

- `fraction` runs from 0 to 1.
- `label` is a word or two: "Uploading", "Downloading", "Fetching files",
  "Adding to nook". No ellipsis; the bar says it is under way.
- `detail` is the numbers, made by `formatProgressDetail` in
  `shared/waiting.js`: bytes when the sizes are known ("12 MB of 30 MB",
  both in the total's unit), a count when they are not ("12 of 26 files").
  A rate may follow ("12 of 30 · 2.1 MB/s", `formatRate`) when there is room.
- It is `role="progressbar"` with `aria-valuenow`, `aria-valuemin`,
  `aria-valuemax`, `aria-label` (the label) and `aria-valuetext` (the detail).
- A bar never animates without a total. Given a `fraction` of `null`
  (or anything that is not a number) it renders `Working` instead, with the
  label given an ellipsis. Use `progressFraction(loaded, total)` to make the
  fraction; it is `null` when there is no total.
- When the bar reaches 1 it is held for about 300 ms (`PROGRESS_HOLD_MS`,
  `holdFullBar`) so it is seen full, and then the caller replaces it with
  the result. If the wait goes on into a stage that cannot be measured,
  the caller swaps in `Working`.

**`Working`** is a wait that cannot be measured. The one `.spinner`, one
size and one colour everywhere, followed by the label in the same secondary
style.

```jsx
<Working label="Extracting…" />
```

- `label` ends in an ellipsis: "Extracting…", "Capturing webpage…",
  "Loading board…", "Please wait…".
- It is `role="status"` with `aria-live="polite"`.

## The rules

- Neither is modal and neither blocks the page.
- Each sits exactly where the result will appear: in the upload card, over
  the viewer's page area, on the board card, in the export panel, in the
  profile's sync block. A page that is not here yet centres its `Working`
  in a `.loading` block.
- A button that started the wait is disabled and shows the label as its
  text ("Fetching files", "Signing in…") rather than a second spinner.
- An error replaces the indicator in place, in the app's existing error
  style.
- Nothing under a second gets a bar or a spinner; the disabled button with
  its label is enough.
- Dark mode, when it comes, follows the app's tokens: the components use
  `--accent`, `--line`, `--ink-faint`, `--fs-sm`, `--font-ui` and nothing
  of their own.
- Nothing else draws a wait. No app-local spinner, bar, or "Loading…"
  string; find the existing ones with
  `git grep -n -i -E 'spinner|Loading|Please wait|progressbar' -- frontend/src viewer/src board/src shared`
  and they are all one of the two.

## Where each is used

| Wait | Component | Label · detail |
| --- | --- | --- |
| Viewer, the PDF downloading (pdf.js `onProgress`) | `Progress` | Downloading · bytes |
| Viewer, the PDF arriving through native sync | `Progress` | Syncing · bytes so far |
| Viewer, before the size is known | `Working` | Loading… |
| My data, the files fetched (the manifest sizes them) | `Progress` | Fetching files · bytes · files |
| My data, the data and the zip | `Working` | Gathering… / Packing… |
| Desktop sync, once a phase is counted | `Progress` | phase · "12 of 30 · 2.1 MB/s" |
| Desktop sync, before the first count | `Working` | Starting… |
| Desktop toolbars while a sync runs | `Working` | Syncing… |
| Board, capturing a pasted link | `Working` | Capturing webpage… / Loading video frame… |
| Board, the board and its images | `Working` | Loading board… / Loading… |
| Paper page, metadata from the PDF | `Working` | Extracting… |
| Every page not yet here | `Working` | Loading … |
| Sign-in, comments, avatars, settings | disabled button | Signing in… / Adding… / Uploading… |

Uploads — the paper upload, board file drops, the desktop's Add to nook —
are measured over the hashing and the PUT (`Progress` "Uploading" in bytes)
and then `Working` "Extracting…" for the server's reading; see the shared
file helper for the `onProgress({ phase, loaded, total })` callback that
drives them.

## Testing

`frontend/src/waiting.test.js` renders both components with
`react-dom/server` and checks the roles, the fallback and the formatter.
The shared modules find `react` through `frontend/src/resolveFromApp.mjs`,
a resolution hook the frontend's unit tests register, since `shared/` has no
`node_modules` of its own.
