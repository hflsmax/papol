import React from 'react';

// Line glyphs for Papol macOS's chrome, drawn in currentColor on a 24-unit
// grid so each takes its colour and size from the control around it.
const GLYPHS = {
  papers: <><path d="M8 3.5h7l4 4V18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M15 3.5v4h4M4.5 7v12.5a1 1 0 0 0 1 1H15" /></>,
  boards: <path d="M4.5 4.5h6v6h-6zm9 0h6v6h-6zm-9 9h6v6h-6zm9 0h6v6h-6z" />,
  nook: <><path d="M4.5 11 12 4.5l7.5 6.5" /><path d="M6.5 9.5v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9" /><path d="M10 19.5v-5h4v5" /></>,
  // Drawn half a unit up, so its ink is centred on the grid like the rest.
  room: <g transform="translate(0 -0.5)"><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5" /><circle cx="16.8" cy="8.2" r="2.4" /><path d="M16.6 13.2c2.2.2 3.7 1.7 4 4.3" /></g>,
  inbox: <g transform="translate(0 -0.5)"><path d="M4 13 6.6 5.5h10.8L20 13v5.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13h4.5l1 2.2h5l1-2.2H20" /></g>,
  learn: <><circle cx="12" cy="12" r="8.5" /><path d="M10.2 8.8v6.4l5-3.2z" /></>,
  admin: <path d="M12 3.5 19 6v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" />,
  signin: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  join: <><circle cx="10" cy="8.5" r="3.5" /><path d="M3.5 19.5c1.1-3.6 3.5-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.5M18 13v6m-3-3h6" /></>,
  feedback: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  manage: <><path d="M4.5 7.5h9m4 0h2m-15 9h2m4 0h9" /><circle cx="15.5" cy="7.5" r="2" /><circle cx="8.5" cy="16.5" r="2" /></>,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  projects: <><path d="M7 5.5h3.5l1.5 1.5H18a1 1 0 0 1 1 1V10" /><path d="M4 10a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /></>,
  folder: <path d="M4 7a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m19.5 19.5-4.6-4.6" /></>,
  document: <><path d="M14 4.5H7.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8z" /><path d="M14 4.5V8h3.5M9.5 12.5h5m-5 3h3" /></>,
};

export default function Glyph({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{GLYPHS[name]}</svg>;
}
