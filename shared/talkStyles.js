// The dig pin and the dig card, worn by anything in a project that can
// hold a dig: on the project pages, and in the viewer on another member's
// annotation once a project is on. One sheet, so the two apps draw them
// alike.
export const talkStyles = `
/* Talk: one pin and one card for discussing anything in a project. The pin
   is the viewer's note pin; the card is a board card, lifted. */
.talk-pin-wrap { position: relative; display: inline-flex; flex: none; align-items: center; gap: var(--space-1); vertical-align: middle; }
/* The dig pin: a spade, then the dig's post count. The spade's size is the
   pin's height; the count sits beside it, so any number fits. */
.talk-pin { position: relative; display: inline-flex; flex: none; align-items: center; gap: 1px; height: 28px; min-width: 28px; justify-content: center; padding: 0 3px; border: 0; border-radius: 999px; background: none; box-shadow: none; color: var(--accent-strong); cursor: pointer; transition: opacity var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out); }
.talk-sm .talk-pin { height: 24px; min-width: 24px; }
.talk-lg .talk-pin { height: 34px; min-width: 34px; padding: 0 4px; }
.talk-glyph path { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.talk-glyph .talk-glyph-blade { fill: var(--accent-soft); }
.talk-glyph.is-outline .talk-glyph-blade { fill: none; }
.talk-pin .talk-glyph { display: block; flex: none; width: 22px; height: 22px; overflow: visible; }
.talk-sm .talk-pin .talk-glyph { width: 19px; height: 19px; }
.talk-lg .talk-pin .talk-glyph { width: 28px; height: 28px; }
.talk-pin:hover:not(:disabled), .talk-pin:focus-visible { border: 0; background: none; color: var(--accent); }
.talk-pin:focus-visible { outline: none; }
.talk-pin:focus-visible::before, .talk-pin.is-open::before { content: ''; position: absolute; inset: -3px; z-index: -1; border: 2px solid var(--accent); border-radius: 999px; background: var(--accent-soft); box-shadow: 0 0 0 2px var(--focus-soft); }
.talk-count { color: var(--accent-strong); font: 650 var(--fs-xs)/1 var(--font-ui); font-variant-numeric: tabular-nums; pointer-events: none; }
.talk-sm .talk-count { font-size: var(--fs-2xs); }
.talk-lg .talk-count { font-size: var(--fs-sm); }
.talk-pin.is-empty { color: var(--accent); opacity: 0; }
.talk-pin.is-empty:hover, .talk-pin.is-empty:focus-visible, .talk-pin.is-empty.is-open { opacity: 1; }
.talk-host:hover .talk-pin.is-empty, .talk-host:focus-within .talk-pin.is-empty, .talk-host.selected .talk-pin.is-empty, .talk-host.is-selected .talk-pin.is-empty { opacity: .9; }
@media (hover: none) { .talk-pin.is-empty { opacity: .6; } }
.talk-pin.is-new::after { content: ''; position: absolute; top: -1px; right: -2px; width: 9px; height: 9px; border: 2px solid var(--card); border-radius: 50%; background: var(--gold); }


/* The first word on something: a few sparks fly off the pin. */

/* The talk card: a board card lifted off the canvas. */
.talk-card { position: fixed; z-index: 300; display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 16px)); overflow: hidden; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--card); box-shadow: var(--shadow-md), 0 2px 5px rgba(29,33,41,.09); color: var(--ink); font-family: var(--font-ui); opacity: 0; visibility: hidden; }
.talk-card.is-placed { visibility: visible; animation: talk-open var(--motion-fast) var(--ease-out) forwards; }
.talk-card.is-sheet { left: 0; right: 0; bottom: 0; max-height: 78vh; border-radius: 14px 14px 0 0; border-bottom: 0; transform-origin: 50% 100%; }
.talk-card.is-inline { position: relative; z-index: auto; max-height: min(640px, calc(100vh - 2 * var(--space-4))); opacity: 1; visibility: visible; box-shadow: var(--shadow-sm); animation: none; }
.talk-card.is-inline .talk-card-open { margin-left: auto; }
[data-shell='desktop'] .talk-card.is-inline { max-height: calc(100vh - 52px - 2 * var(--space-4)); }
@keyframes talk-open { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .talk-card.is-placed { animation: none; opacity: 1; } .talk-pin { transition: none; } }
.talk-card-header { flex: none; display: flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: 5px 7px 5px 10px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper) 72%, var(--card)); }
.talk-card-kind { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.talk-card-kind i { display: inline-grid; place-items: center; color: var(--accent-strong); }
.talk-card-kind i .talk-glyph { width: 15px; height: 15px; }
.talk-card-count { color: var(--ink-faint); font: var(--fs-2xs) var(--font-ui); }
.talk-card-open, .talk-card-close { display: inline-grid; width: 26px; height: 26px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; box-shadow: none; color: var(--ink-soft); font: 400 20px/1 var(--font-ui); }
.talk-card-open { margin-left: auto; }
.talk-card-close { margin-left: auto; }
.talk-card-open + .talk-card-close { margin-left: 0; }
.talk-card-open svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.talk-card-open span { display: none; }
.talk-card.is-inline .talk-card-open { display: inline-flex; align-items: center; gap: var(--space-1); width: auto; padding: 0 var(--space-2); border-radius: 999px; font: 500 var(--fs-xs) var(--font-ui); }
.talk-card.is-inline .talk-card-open span { display: inline; }
.talk-card-open:hover, .talk-card-close:hover:not(:disabled) { border: 0; background: var(--accent-soft); color: var(--accent); }
.talk-card-subject { flex: none; margin: 0; padding: var(--space-3) var(--space-4) var(--space-2); overflow: hidden; color: var(--ink); font: 600 var(--fs-md)/1.35 var(--font-serif); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; border-bottom: 1px solid var(--line); }

.talk-card-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: var(--space-2) var(--space-4) 0; }
.talk-card-quiet { margin: var(--space-2) 0 var(--space-3); color: var(--ink-faint); font: var(--fs-sm) var(--font-ui); }
.talk-posts { margin: 0; padding: 0 0 var(--space-1); list-style: none; }
.talk-post + .talk-post { border-top: 1px solid var(--line); }
.talk-post-head { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 2px; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.talk-post-head .mini-avatar { width: 18px; height: 18px; font-size: 10px; }
.talk-post-head b { color: var(--ink); font-weight: 600; }
.talk-post.is-mine .talk-post-head b { color: var(--accent); }
.talk-post.is-new .talk-post-head time::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--gold); vertical-align: middle; }
.talk-post-body { color: var(--ink); font: var(--fs-sm)/1.32 var(--font-serif); overflow-wrap: anywhere; }
.talk-post-body p, .discussion-post-body p { margin: 0 0 3px; }
.talk-post-body :is(ol, ul), .discussion-post-body :is(ol, ul) { margin: 0 0 3px; padding-left: 1.3em; }
.talk-post-body li, .discussion-post-body li { margin-bottom: 0; }
.talk-post-body > :first-child { margin-top: 0; }
.talk-post-body > :last-child { margin-bottom: 0; }
.talk-card-error { margin: 0 var(--space-4) var(--space-2); color: var(--red); font: var(--fs-xs) var(--font-ui); }
/* Following a drift: pick a post, dig into what it is about. */
.talk-post { margin: 0 calc(-1 * var(--space-2)); padding: 6px var(--space-2); border-radius: 6px; cursor: default; }
.talk-post:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.talk-post.is-selected { background: color-mix(in srgb, var(--accent-soft) 55%, transparent); }
.talk-post-actions { display: flex; justify-content: flex-end; margin-top: var(--space-2); }
.talk-post-actions button { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: 999px; background: var(--card); box-shadow: none; color: var(--accent); font: 500 var(--fs-xs) var(--font-ui); }
.talk-post-actions button:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.talk-post-actions .action-glyph { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.talk-card-back { flex: none; display: flex; align-items: center; gap: var(--space-1); width: 100%; margin: 0; padding: var(--space-2) var(--space-4) 0; overflow: hidden; border: 0; border-radius: 0; background: none; box-shadow: none; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); text-align: left; white-space: nowrap; text-overflow: ellipsis; }
.talk-card-back:hover:not(:disabled) { border: 0; background: none; color: var(--accent); }
.dig-chooser { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); padding: var(--space-2) 0 var(--space-4); }
.dig-chooser-quote { margin: 0; padding-left: var(--space-3); border-left: 2px solid var(--line-strong); color: var(--ink-soft); font: var(--fs-sm)/1.45 var(--font-serif); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.dig-chooser-idea { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); margin-top: var(--space-2); }
.dig-chooser-idea input { min-width: 0; margin: 0; }
.dig-chooser-or { margin: 0; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.dig-chooser-or { margin-top: var(--space-2); }
.dig-chooser-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; margin: 0; padding: 0; list-style: none; }
.dig-chooser-list button { display: flex; min-width: 0; align-items: baseline; gap: var(--space-2); width: 100%; padding: var(--space-2); border: 0; border-radius: 6px; background: none; box-shadow: none; color: var(--ink); font: var(--fs-sm) var(--font-ui); text-align: left; }
.dig-chooser-list button:hover:not(:disabled) { border: 0; background: var(--accent-soft); color: var(--ink); }
.dig-chooser-kind { flex: none; width: 3.6rem; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.dig-chooser-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dig-chooser-cancel { justify-self: start; padding: var(--space-1) 0; border: 0; background: none; box-shadow: none; color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
.dig-chooser-cancel:hover:not(:disabled) { border: 0; background: none; color: var(--accent); }

.talk-compose { flex: none; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: end; gap: var(--space-2); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4); border-top: 1px solid var(--line); background: color-mix(in srgb, var(--paper) 50%, var(--card)); }
.talk-compose .mini-avatar { width: 22px; height: 22px; margin-bottom: 6px; font-size: 11px; }
.talk-compose textarea { width: 100%; min-height: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); font: var(--fs-md)/1.45 var(--font-serif); resize: vertical; }
.talk-compose textarea:focus { border-color: var(--accent); background: var(--card); box-shadow: 0 0 0 2px var(--focus-soft); outline: none; }
.talk-send { display: inline-grid; width: 34px; height: 34px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: var(--accent); box-shadow: none; color: var(--ink-inverse); transition: opacity var(--motion-fast) var(--ease-out); }
.talk-send svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.talk-send:hover:not(:disabled) { border: 0; background: var(--accent-strong); color: var(--ink-inverse); }
.talk-send:disabled { opacity: .35; }
`;
