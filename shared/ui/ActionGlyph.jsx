import React from 'react';

export default function ActionGlyph({ name }) {
  const paths = {
    send: <path d="M7 17 17 7M9 7h8v8" />,
    external: <><path d="M13 5h6v6M19 5l-9 9" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></>,
    backlink: <><path d="M10 3h6l4 4v14H10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M16 3v4h4M12 10h4M12 14h4" /><path d="M3 15h9M6 12l-3 3 3 3" /></>,
    download: <><path d="M12 4v11M8 11l4 4 4-4" /><path d="M5 19h14" /></>,
    trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /><path d="M10.5 11v5M13.5 11v5" /></>,
    lock: <><rect x="5.5" y="10" width="13" height="9" rx="2" /><path d="M8.5 10V7.2a3.5 3.5 0 0 1 7 0V10" /><circle cx="12" cy="14.5" r="1" className="action-glyph-fill" /></>,
    unlock: <><rect x="7" y="10" width="11" height="9" rx="2" /><path d="M10 10V7.5a4 4 0 0 1 7.2-2.4" /><circle cx="12.5" cy="14.5" r="1" className="action-glyph-fill" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    dig: <g transform="rotate(32 12 12)"><path d="M6.8 10.5h10.4v4.6c0 3-2.4 5.6-5.2 7.1-2.8-1.5-5.2-4.1-5.2-7.1Z" /><path d="M12 10.5V4.2M9.6 2.2h4.8v2H9.6Z" /></g>,
    add: <><path d="M12 4v10M7 9h10" /><path d="M4 14v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    'take-out': <><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></>,
    discuss: <path d="M7.5 3.5h9a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5H12l-4.2 3.3c-.4.3-1 .03-1-.5v-2.9A5 5 0 0 1 2.5 11.5v-3a5 5 0 0 1 5-5Z" />,
    edit: <><path d="M5 19h4L19 9l-4-4L5 15Z" /><path d="M13 7l4 4" /></>,
  };

  return <svg className="action-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
