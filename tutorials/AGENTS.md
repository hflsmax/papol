# Tutorial agent instructions

These instructions apply to all work under `tutorials/`.

## Required reference

Before creating, editing, recording, encoding, or publishing a Papol tutorial
video, read `VIDEO_PRODUCTION_GUIDE.md` completely and follow it. Treat its
requirements and definition of done as part of the task.

## Non-negotiable workflow

- Use the repository `flake.nix` through `nix develop`. Do not use
  `nix-shell`.
- Keep each tutorial's narration, subtitles, voice-generation script,
  recording script, and final video together in its tutorial directory.
- Make narration describe the visible actions in their exact order.
- Use live element bounds for clicks and drags; do not guess coordinates for
  controls whose positions can change.
- Review representative source frames and the complete encoded video. A
  successful automation run is not sufficient verification.
- Preserve user data. Track and remove only records and files created by the
  recording run.
- Remove generated frames, temporary environments, recording dependencies,
  and recording-only uploads after verification.
- When publishing, copy the final MP4 to `frontend/public/assets/learn/`, add
  or update its catalog entry in `frontend/src/components/LearnPage.jsx`, and
  build the frontend.
- Every Learn card contains exactly one video and one title unless the user
  explicitly changes the Learn-page design.

## Change propagation

- Narration wording changed: update `narration.txt`, regenerate
  `narration.wav`, update `captions.srt` text and measured timing, re-encode,
  and republish the MP4.
- Visible action or crop changed: update `record.mjs`, record a fresh frame
  sequence, inspect it, re-encode, and republish the MP4.
- Timing changed: recheck every later action against narration; do not assume
  only the edited segment moved.
- Learn-page title changed: update the lesson catalog entry. Do not burn the
  catalog title into the video.

## Lessons from previous recordings

- Write the complete narration before scripting the recording. Build a timed
  action list from it, and make every visible action occur in the same order as
  the words that describe it.
- Prefer one continuous interaction path. When multiple takes are necessary,
  match the viewport, zoom, scroll position, pointer position, and UI state so
  the edit does not jump.
- Move the pointer slowly and deliberately, with extra approach time before a
  click. After choosing a mode, move the pointer away from the control before
  demonstrating the result.
- Resolve click and drag targets from current DOM bounds. Inspect the recorded
  frames to confirm the pointer actually lands on the intended control, resize
  handle, text, or paper area.
- Center the subject before recording and minimize camera, zoom, and scroll
  movement. If the narration describes a specific region, the viewport must
  visibly show that region.
- Demonstrate claims literally. If the narration says resize then move, record
  resize then move. Give consequential actions, such as sending to a board,
  enough screen time to be understood.
- Crop clips tightly around the intended figure or excerpt. Exclude captions,
  surrounding prose, and unrelated page content unless they are essential to
  the explanation.
- Keep a roughly 40-second tutorial to the essential workflow. End with a short
  result demonstration rather than another explanation. Treat 40 seconds as a
  default, not a constraint: when clarity needs more time, retime the complete
  lesson and use the longer duration.
- Do not compress several consequential actions into one hurried closing line.
  Give each action and the visible result separate beats when they matter.
- A `padTo` helper is only a lower bound: it cannot recover time already spent
  on clicks, typing, waits, or cursor movement. Inspect actual frame numbers at
  every narration boundary after adding an interaction.
- Enter `nix develop` before production and run repository-relative recorder
  commands from the repository root. The flake provides the browser driver and
  media tools; do not install recorder dependencies manually.
- Use a natural voice and confirm the final narration is complete, audible, and
  not clipped at either end.
- Watch the complete final MP4 with sound. Check continuity, narration/action
  synchronization, pointer accuracy, accidental clicks, clean crops, and the
  final frame; frame sampling alone is not enough.

Do not report completion until every applicable verification item in
`VIDEO_PRODUCTION_GUIDE.md` passes.
