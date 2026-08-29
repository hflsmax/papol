# Papol

Papol is a web app for reading and discussing research papers. Readers
organize papers in public or private shelves, add private tags and notes, and
share ratings and short thoughts. Any reader can call a spontaneous seminar
and invite others reading the same paper to join.

For native-resolution YouTube frames on boards, set
`PAPOL_YOUTUBE_PO_TOKEN` to an mweb GVS PO token and optionally set
`PAPOL_YOUTUBE_COOKIES` to an absolute Netscape-format cookies file path in
Papol's `.env`. Without them, YouTube may expose only a lower-resolution
public stream; Papol scales that fallback for display but cannot recreate its
missing detail.
