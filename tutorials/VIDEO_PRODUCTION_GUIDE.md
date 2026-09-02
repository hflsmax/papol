# Papol tutorial video production guide

This is the execution reference for agents producing Papol tutorial videos.
Read `AGENTS.md` first; its requirements apply throughout. This guide explains
how to carry them out without repeating the full policy checklist.

## Tutorial directory

Keep each tutorial self-contained:

| File | Responsibility |
|---|---|
| `narration.txt` | Spoken script, preferably one scheduled sentence per line |
| `captions.srt` | Narration text with measured speech boundaries |
| `generate_voice.py` | Voice selection, speed, line starts, and audio mix |
| `record.mjs` | Browser setup, cursor choreography, actions, and frame capture |
| `narration.wav` | Generated narration track |
| Final MP4 | Encoded source video |

Use the existing tutorial directories as implementation examples. Keep frame
sequences, package environments, and recording-only uploads temporary.

Published videos live in `frontend/public/assets/learn/`. Their catalog entries
live in the `lessons` array in `frontend/src/components/LearnPage.jsx`.

## Production sequence

1. Write the complete narration.
2. Turn each narrated action into a timed recording action in the same order.
3. Generate the voice line by line and measure its actual boundaries.
4. Create subtitles from the narration and measured timing.
5. Record one continuous browser interaction when practical.
6. Inspect representative source frames before encoding.
7. Encode the video and audio, burning in subtitles when the tutorial uses them.
8. Watch the entire final MP4 with sound and correct every failed check.
9. Publish the verified MP4, update the catalog, and build the frontend.
10. Remove recording-created data and temporary production artifacts.

## Story and duration

Unless the user requests otherwise, target 40 seconds. Include only the actions
needed to understand the feature. A useful structure is:

1. State the general problem or goal.
2. Connect it to the feature: “When that happens, you can…”
3. Demonstrate the essential workflow in narrated order.
4. Briefly show an important alternative mode, if one exists.
5. End on the visible result with a short Papol sign-off.

Use direct, conversational language. Describe what the viewer can do. Mention
interface names only when the viewer needs them to locate or choose something.

## Voice and subtitles

- Prefer the established natural voice in the tutorial being updated. For a new
  tutorial, use Kokoro `af_heart` at speed `0.8` unless a better
  repository-supported voice has been adopted.
- Generate speech line by line and assign explicit line starts. Reject overlaps
  and any line that extends beyond the requested duration.
- Preserve intentional silence between ideas.
- Make subtitle text match the generated narration word for word.
- Derive subtitle end times from generated audio boundaries, not estimates.
- Inspect an encoded subtitle frame; libass sizing can differ from expectations.
- Listen to the opening and closing words and confirm neither is clipped.

## Recording and cursor choreography

- Record at 1280 × 720 and capture at 15 fps unless the tutorial requires a
  different format.
- Use the authentic application UI. Collapse unrelated panels and avoid added
  overlays beyond the pointer, restrained click cues, and subtitles.
- Resolve click, drag, and resize targets from current DOM bounds. Coordinates
  guessed before zooming, scrolling, or opening a dialog are not reliable.
- Use slow eased approaches before clicks. Pause briefly at a drag handle, then
  complete the gesture in one clean path.
- Keep the pointer still while introducing a problem or layout.
- After selecting a mode, move the pointer away from its control before showing
  the effect.
- Preserve timing when slowing a gesture by shortening static holds, then
  recheck every later action against the narration.

## Framing and continuity

- Center the subject before recording and minimize viewport movement.
- Use normal application zoom and scrolling; do not move document elements to
  fake framing.
- When the narration names a region, the recording must visibly show that exact
  region.
- Prefer a continuous interaction path. If takes must be joined, match viewport
  size, zoom, scroll, pointer position, and UI state at the edit.
- Keep the pointer away from unrelated controls during camera or document
  movement.

## Encoding

Encode at 30 fps using H.264 video, AAC audio, and `yuv420p` pixel format for
broad browser compatibility. Use `ffprobe` on the final file to verify:

- requested duration;
- 1280 × 720 dimensions unless intentionally changed;
- H.264 video;
- AAC audio;
- expected frame rate.

## Publishing and cleanup

- Copy the final MP4 to `frontend/public/assets/learn/` and add or update one
  catalog entry in `frontend/src/components/LearnPage.jsx`.
- Each lesson card has one title. Do not add descriptions, durations, badges, or
  other text unless the Learn-page design is intentionally changing.
- Confirm the tutorial source MP4 and published MP4 have identical checksums.
- Build the frontend after publishing. If the catalog or layout changed, inspect
  the Learn page at desktop and mobile widths.
- Track and delete only database rows and uploads created by the recording run.
- Remove temporary frames, dependencies, voice environments, and recording-only
  uploads after verification. Preserve reusable source scripts and media.

## Lesson-specific checks

Apply only the checks relevant to the feature being demonstrated.

For clipping:

- Crop only the intended figure or excerpt, excluding captions and surrounding
  prose unless requested.
- Inspect every crop edge at full size and include the complete target.
- Demonstrate resizing with the real handle and make the size change visible.
- Place the result beside the relevant content without covering it.
- If showing pinned and floating behavior, keep both scroll demonstrations short
  and move the pointer over the paper before scrolling.

For sending to a board:

- Leave enough time to see the chooser, board selection, and send action.
- If demonstrating staging, visibly drag the item from staging onto the board.
- If demonstrating a backlink, open it and show that it returns to the source.

For board grouping:

- Make the structural difference visible: a booklet orders cards along a spine;
  a collection groups cards spatially inside a boundary.
- Show the actual grouping action rather than only the completed state.

## Final review

Do not trust a successful automation run. Watch the complete encoded video with
sound, then confirm:

- narration, voice, and subtitles agree;
- actions appear in the narrated order and at the narrated time;
- every click and drag lands on its intended live target;
- pointer approaches are slow enough to identify controls;
- framing is intentional and transitions do not jump;
- crops and feature-specific demonstrations are clean and complete;
- the final phrase and final frame are not cut off;
- `ffprobe`, checksums, frontend build, and `git diff --check` pass;
- recording-created data and temporary artifacts have been cleaned safely.

Any timing change requires another complete watch because it can shift every
later interaction.
