# Papol tutorial video production guide

This is the execution reference for agents producing Papol tutorial videos.
Read it completely before changing a tutorial. Requirements use **must**;
recommendations use **prefer**. Do not declare completion until the definition
of done at the end passes.

## Repository map

For the clipping tutorial, the source of truth is
`tutorials/clipping-functionality/`:

| File | Responsibility |
|---|---|
| `narration.txt` | Spoken script, one scheduled sentence per line |
| `captions.srt` | On-screen text and measured speech boundaries |
| `generate_voice.py` | Voice, speed, line starts, and 40-second audio mix |
| `record.mjs` | Browser state, cursor choreography, actions, and frame capture |
| `narration.wav` | Generated narration track |
| `papol-clipping-tutorial.mp4` | Final source video |

The published MP4 lives at
`frontend/public/assets/learn/clipping-functionality.mp4`. The Learn catalog is
the `lessons` array in `frontend/src/components/LearnPage.jsx`.

For a new tutorial, prefer the same file layout in a new directory. Keep
generated frame sequences and dependency environments temporary.

## Change-impact rules

Before working, classify the request and perform every action in its row:

| User change | Required work |
|---|---|
| Narration wording | Edit script, regenerate voice, measure timing, edit subtitles, re-encode, publish |
| Cursor/action/crop | Edit recorder, capture new frames, inspect frames, re-encode, publish |
| Timing | Regenerate affected media and verify all later narration/action alignment |
| Learn card title | Edit the Learn catalog and rebuild frontend |
| Learn layout | Edit component, shared CSS/design documentation, build, inspect desktop and mobile |

Never update only the tutorial source MP4 when a published Learn-page copy
exists. Confirm both MP4 files have identical checksums.

## Output requirements

- The video must be 40 seconds unless the user requests another duration.
- Record at 1280 × 720. The smaller viewport keeps controls and gestures easy
  to see without making the interface feel cramped.
- Capture at 15 fps and encode at 30 fps with H.264 video, AAC audio, and
  `yuv420p` pixel format for broad browser compatibility.
- Keep the application UI authentic. Collapse unrelated side panels and avoid
  adding explanatory overlays beyond the cursor, click cue, and subtitles.
- Use one continuous recording. Do not splice between setup and demonstration
  states when a smooth zoom, scroll, or pointer movement can connect them.

## Start with the story

Write the narration from beginning to end before polishing the automation. A
useful structure is:

1. State a general reading problem.
2. Connect it to the feature: “When that happens, you can…”
3. Demonstrate the feature in the same order in which it is described.
4. Show one or two related modes briefly.
5. End with a short Papol sign-off.

Keep the language direct and durable. Describe what the reader can do, not why
they might want it later. Use interface names only when the reader must locate
or choose them. Avoid unnecessary implementation or project-specific names.

The narration and actions must agree exactly. If the recording resizes before
moving, say “resize it, then place it,” not the reverse. Rewatch with sound and
verify every verb against the action visible at that moment.

## Voice and subtitles

- Use Kokoro with the `af_heart` voice at speed `0.8` for a natural delivery.
- Generate speech line by line and place each line at an explicit start time.
- Reject the render if lines overlap or if the final line would pass 40 seconds.
- Keep intentional silence between ideas; do not fill every second with speech.
- Subtitle text must match the generated narration word for word.
- Set subtitle end times from the generated audio boundaries rather than
  estimating them.
- Burn in readable subtitles with a compact dark background. Always inspect an
  encoded frame: libass font sizes can render much larger than expected.
- Make sure the final phrase is complete and not clipped by the video duration.

## Cursor choreography

The cursor is part of the explanation, not decoration.

- Move deliberately and slowly before every click so the viewer can identify
  the target.
- Use smooth eased paths and the minimum number of movements needed.
- Keep the pointer still while introducing a layout or explaining a problem.
- Show a restrained click cue directly on the actual target.
- For dragging, approach the handle slowly, pause just enough to establish the
  grab point, and then move in one clean path.
- Confirm target coordinates from live element bounds. Do not rely on guessed
  screen positions after zooming, scrolling, resizing, or opening a dialog.
- After choosing a floating mode, move the pointer away from the clip and over
  the paper before scrolling. This makes it obvious that the paper is being
  operated while the clip remains in place.

Slower movement should not make the narration drift. Preserve action time by
shortening static holds, not by speeding up a different gesture. Recheck the
start time of every later segment after changing cursor duration.

## Framing and continuity

- Keep the PDF page itself centered whenever the whole page is visible.
- Use the viewer's normal horizontal and vertical scrolling to bring a reading
  area into view. Do not physically shift the PDF element; that makes the page
  look off-center and creates discontinuities when zoom changes.
- When demonstrating the problem, zoom into the actual text being read and
  scroll to its lower-left position. The relevant visual should naturally move
  out of view.
- Avoid zooming out farther than necessary during clipping. The figure and crop
  boundary must remain legible.
- Use continuous zoom and scroll animation between the problem and solution.
  Abrupt state changes look like recording glitches even when technically
  correct.
- Keep the cursor away from unrelated controls during zooming, especially the
  Feedback button.

## Making a clean clip

- Crop only the figure. Exclude its caption and all surrounding body text.
- Inspect every edge of the crop at full size. Extend the crop far enough right
  to include the complete figure rather than cutting off its outer content.
- Leave a small amount of visual breathing room around the graphic without
  capturing adjacent prose.
- Demonstrate resize using the real resize handle. The cursor must visibly grab
  the handle and the clip must visibly change size.
- After resizing, place the clip to the right of the text being read. Leave a
  clear gap so the clip does not cover the column.

## Boards, pinned clips, and floating clips

- Give the board action enough screen time to understand: open Send, show the
  board chooser, choose a board, and send.
- Narrate it simply: “You can also send the clip to a board.”
- Keep confirmation states brief if they are not part of the narration.
- Demonstrate pinned scrolling first: scroll a short distance and show the clip
  moving with the paper.
- Then choose Free float, move the cursor over the paper, and scroll briefly.
  The clip should remain fixed on screen.
- Keep both scrolling demonstrations short so the distinction is clear without
  dragging out the ending.

## Verification procedure

Do not trust the automation merely because it completed. Review the result as a
viewer would. If any check fails, fix it and repeat all checks affected by the
change.

1. Inspect representative source frames from every segment.
2. Watch the complete encoded video with sound.
3. Check every click lands on the intended control.
4. Check narration and visible actions match in order and timing.
5. Check zooms and scrolls form continuous transitions.
6. Check the PDF and reading area are framed as intended.
7. Check the crop contains the complete figure and no caption or body text.
8. Check resize, reposition, board send, pinned scroll, and floating scroll are
   all visibly demonstrated.
9. Check subtitles are readable, correctly timed, and not oversized.
10. Use `ffprobe` to confirm 1280 × 720, H.264/AAC, and exactly 40 seconds.

When a change affects timing, regenerate and review the whole video. A local fix
near the beginning can shift every later interaction.

## Reproducible execution

- Use `flake.nix` through `nix develop`; do not use an ad-hoc `nix-shell`.
- Keep narration in `narration.txt`, subtitle timing in `captions.srt`, voice
  generation in `generate_voice.py`, and browser choreography in `record.mjs`.
- Record frames from a local Papol server, then encode the image sequence with
  the generated narration and burned-in subtitles.
- The recording script should track and delete only the clip and board item it
  created. Never alter existing user data.
- Remove generated frames, temporary dependencies, voice environments, and
  recording-only uploads after validation.
- Copy the final MP4 to `frontend/public/assets/learn/`, then rebuild the
  frontend. The tutorial source and Learn-page copy should have identical
  checksums.

## Adding the next lesson

Add the MP4 and poster under `frontend/public/assets/learn/`, then add one entry
to the `lessons` array in `frontend/src/components/LearnPage.jsx`. Each grid card
contains exactly one video and one title. Do not add descriptions, duration,
topic labels, featured states, or introductory copy unless the Learn-page design
is intentionally changed for every lesson.

## Definition of done

An agent may report completion only when all applicable statements are true:

- The narration text, generated voice, and subtitles match word for word.
- Every narrated action appears on screen in the narrated order.
- Every click and drag lands on its intended live UI target.
- Cursor approaches are slow enough to identify the next control.
- Transitions are continuous and the PDF framing is intentional.
- The crop includes the full target graphic and excludes captions and body text.
- The complete encoded video has been watched with sound.
- `ffprobe` confirms the requested duration, 1280 × 720, H.264, and AAC.
- `git diff --check` passes.
- Recording-created database rows and uploads are cleaned without touching
  pre-existing data.
- Temporary frames, dependencies, and voice environments are removed.
- The source and published MP4 checksums match.
- The frontend production build passes.
- The Learn page has been visually checked at desktop and mobile widths if its
  catalog or layout changed.
