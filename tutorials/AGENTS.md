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

Do not report completion until every applicable verification item in
`VIDEO_PRODUCTION_GUIDE.md` passes.
