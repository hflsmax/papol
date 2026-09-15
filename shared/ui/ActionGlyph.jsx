import React from 'react';

export default function ActionGlyph({ name }) {
  const paths = {
    send: <path d="M7 17 17 7M9 7h8v8" />,
    external: <><path d="M13 5h6v6M19 5l-9 9" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></>,
    download: <><path d="M12 4v11M8 11l4 4 4-4" /><path d="M5 19h14" /></>,
    trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /><path d="M10.5 11v5M13.5 11v5" /></>,
    lock: <><rect x="5.5" y="10" width="13" height="9" rx="2" /><path d="M8.5 10V7.2a3.5 3.5 0 0 1 7 0V10" /><circle cx="12" cy="14.5" r="1" className="action-glyph-fill" /></>,
    unlock: <><rect x="7" y="10" width="11" height="9" rx="2" /><path d="M10 10V7.5a4 4 0 0 1 7.2-2.4" /><circle cx="12.5" cy="14.5" r="1" className="action-glyph-fill" /></>,
  };

  return <svg className="action-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
