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
[data-shell='desktop'] .talk-card.is-inline { max-height: calc(100vh - 52px - 2 * var(--space-4)); }
@keyframes talk-open { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .talk-card.is-placed { animation: none; opacity: 1; } .talk-pin { transition: none; } }
.talk-card-header { flex: none; display: flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: 5px 7px 5px 10px; background: color-mix(in srgb, var(--paper) 72%, var(--card)); }
.talk-card-close { display: inline-grid; width: 26px; height: 26px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; box-shadow: none; color: var(--ink-soft); font: 400 20px/1 var(--font-ui); }
.talk-card-close { margin-left: auto; }
.dig-phase { margin-left: auto; text-transform: none; letter-spacing: 0; height: 24px; min-height: 0; padding: 2px 26px 0 9px; border: 1px solid var(--line); border-radius: 999px; background-color: transparent; background-position: right 8px center; color: var(--ink-soft); font: 600 var(--fs-2xs)/20px var(--font-ui); cursor: pointer; }
.dig-phase + .talk-card-close { margin-left: 0; }
.dig-phase.is-gold { border-color: var(--accent); color: var(--accent-strong); }
.dig-phase.is-buried { color: var(--ink-faint); }
.talk-card-close:hover:not(:disabled) { border: 0; background: var(--accent-soft); color: var(--accent); }
.talk-card-subject { flex: none; margin: 0; padding: var(--space-3) var(--space-4) var(--space-2); overflow: hidden; color: var(--ink); font: 600 var(--fs-md)/1.35 var(--font-serif); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Whose dig: a thing holds one per member who started one. */
.talk-card-owners { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0 var(--space-4) var(--space-2); }
.talk-card-owners button { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 2px 9px 2px 3px; border: 1px solid transparent; border-radius: 999px; background: none; box-shadow: none; color: var(--ink-soft); font: 600 var(--fs-xs) var(--font-ui); }
.talk-card-owners button .mini-avatar { width: 20px; height: 20px; font-size: 10px; }
.talk-card-owners button:hover:not(:disabled) { border-color: var(--line); background: none; color: var(--ink); }
.talk-card-owners button.is-on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
.talk-card-owners button.talk-card-dig { padding: 2px 6px; }
.talk-card-owners button.talk-card-dig svg { width: 16px; height: 16px; }
.talk-card-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: var(--space-2) var(--space-4) 0; }
.talk-card-quiet { margin: var(--space-2) 0 var(--space-3); color: var(--ink-faint); font: var(--fs-sm) var(--font-ui); }
.talk-posts { margin: 0; padding: 0 0 var(--space-1); list-style: none; }
.talk-post + .talk-post { margin-top: var(--space-2); }
.talk-post-head { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 2px; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.talk-post-head .mini-avatar { width: 18px; height: 18px; font-size: 10px; }
.talk-post-head b { color: var(--ink); font-weight: 600; }
.talk-post.is-mine .talk-post-head b { color: var(--accent); }
.talk-post.is-new .talk-post-head time::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--gold); vertical-align: middle; }
.talk-post-head .item-actions { margin-left: auto; visibility: hidden; }
.talk-post:hover .talk-post-head .item-actions, .talk-post:focus-within .talk-post-head .item-actions { visibility: visible; }
@media (hover: none) { .talk-post-head .item-actions { visibility: visible; } }
.talk-post-edit { display: grid; gap: var(--space-1); }
.talk-post-edit textarea { width: 100%; margin: 0; padding: 6px 8px; border: 1px solid var(--accent); border-radius: 6px; background: var(--card); color: var(--ink); font: var(--fs-sm)/1.4 var(--font-serif); resize: vertical; }
.talk-post-edit textarea:focus { box-shadow: 0 0 0 2px var(--focus-soft); outline: none; }
.talk-post-edit-foot { display: flex; justify-content: flex-end; gap: var(--space-2); }
.talk-post-body { color: var(--ink); font: var(--fs-sm)/1.32 var(--font-serif); overflow-wrap: anywhere; }
.talk-post-body p, .discussion-post-body p { margin: 0 0 3px; }
.talk-post-body :is(ol, ul), .discussion-post-body :is(ol, ul) { margin: 0 0 3px; padding-left: 1.3em; }
.talk-post-body li, .discussion-post-body li { margin-bottom: 0; }
.talk-post-body > :first-child { margin-top: 0; }
.talk-post-body > :last-child { margin-bottom: 0; }
.talk-card-error { margin: 0 var(--space-4) var(--space-2); color: var(--red); font: var(--fs-xs) var(--font-ui); }
.talk-post { margin: 0 calc(-1 * var(--space-2)); padding: 6px var(--space-2); }

.talk-compose { flex: none; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: start; gap: var(--space-2); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4); background: color-mix(in srgb, var(--paper) 50%, var(--card)); }
.talk-compose .mini-avatar { width: 22px; height: 22px; margin-top: 7px; font-size: 11px; }
.talk-compose .talk-send { align-self: end; }
.talk-compose textarea { width: 100%; min-height: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); font: var(--fs-md)/1.45 var(--font-serif); resize: none; max-height: 40vh; overflow-y: auto; }
.talk-compose textarea:focus { border-color: var(--accent); background: var(--card); box-shadow: 0 0 0 2px var(--focus-soft); outline: none; }
.talk-send { display: inline-grid; width: 34px; height: 34px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: var(--accent); box-shadow: none; color: var(--ink-inverse); transition: opacity var(--motion-fast) var(--ease-out); }
.talk-send svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.talk-send:hover:not(:disabled) { border: 0; background: var(--accent-strong); color: var(--ink-inverse); }
.talk-send:disabled { border: 1px solid var(--line-strong); background: none; color: var(--ink-faint); opacity: 1; cursor: default; }
`;
