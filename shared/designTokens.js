// Canonical visual foundations shared by every Papol surface. Keep
// component-specific runtime properties (shelf colors, PDF brush colors,
// board zoom) in their components; everything with a product-wide role lives
// here so the library, board, desktop shell, and viewer cannot drift.
export const designTokens = `
  color-scheme: light;

  /* Ink — text, from strongest to faintest */
  --ink: #1d2129;
  --ink-soft: #4d5561;
  /* Clears WCAG AA for normal text on --paper. */
  --ink-faint: #66717f;

  /* Surfaces */
  --paper: #f5f6f8;
  --paper-sunken: #f1f3f6;
  --card: #ffffff;
  --line: #dde2e8;
  --line-strong: #b4becb;
  --ink-inverse: #ffffff;

  /* Neutral control fills */
  --fill: #ccd4dd;
  --fill-strong: #b8c2cf;

  /* Brand and focus */
  --accent: #2b4a6f;
  --accent-strong: #1e3752;
  --accent-soft: #eaeff5;
  --accent-line: #c3cedd;
  /* A band of the brand across the page (an announcement over the app):
     navy in both themes, quieter at night. */
  --accent-band: #2b4a6f;
  --accent-band-ink: #ffffff;
  --focus: #2b4a6f;
  --focus-soft: rgba(43, 74, 111, 0.2);

  /* Semantic hues */
  --gold: #b3923d;
  --gold-ink: #7a5b1e;
  --gold-soft: #faf3e3;
  --gold-line: #e8d9b5;
  --green: #7ba26c;
  --green-ink: #3d5c34;
  --green-soft: #edf3ea;
  --green-line: #c9d9c1;
  --red: #8c2f22;
  --red-soft: #f9ecea;
  --red-line: #e5c4bd;

  /* User identity colors */
  --identity-0: #2b4a6f;
  --identity-1: #35606b;
  --identity-2: #4a6b52;
  --identity-3: #7a4030;
  --identity-4: #6b3f5e;
  --identity-5: #4b4f7a;

  /* Activity — which paper a stretch of time went to: four hues that stay
     distinct from one another, every pair, for colour-blind eyes too; the
     papers past four share --activity-other. How much time a day held, or a
     paper's effort level, is one hue, light to dark; steps 4 and 5 carry
     --ink-inverse text. */
  --activity-paper-1: #2a78d6;
  --activity-paper-2: #eb6834;
  --activity-paper-3: #1baf7a;
  --activity-paper-4: #4a3aa7;
  --activity-other: #b4becb;
  --activity-heat-1: #e1e9f3;
  --activity-heat-2: #bccfe5;
  --activity-heat-3: #88a9cf;
  --activity-heat-4: #5580b3;
  --activity-heat-5: #2b4a6f;
  /* How long ago a paper on the desk was last read: over two weeks, then
     never. Neutral, so it never reads as effort's blue; --ink and
     --ink-soft stay AA on both. */
  --read-age-1: #e2e7ec;
  --read-age-2: #c6ced8;

  /* Typography */
  --font-serif: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --fs-2xs: 0.7rem;
  --fs-xs: 0.78rem;
  --fs-sm: 0.85rem;
  --fs-md: 0.92rem;
  --fs-base: 0.95rem;
  --fs-lg: 1.05rem;
  --fs-xl: 1.2rem;
  --fs-2xl: 1.4rem;
  --fs-3xl: 1.5rem;
  --fs-hero: 2.1rem;

  /* Shape */
  --radius: 3px;
  --radius-lg: 10px;
  --radius-pill: 999px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  /* Elevation and motion */
  /* Shadows and scrims are this colour at some opacity; a tint of the
     accent (a selection's wash, a pulse) is --accent-rgb at some opacity. */
  --shade-rgb: 29, 33, 41;
  --accent-rgb: 43, 74, 111;
  /* --ink as channels, for a hover or pressed wash of the text colour. */
  --ink-rgb: 29, 33, 41;
  /* Paper-white: what stays white in both themes because it stands for a
     printed page (a PDF page, the page in a drawing). */
  --page: #ffffff;
  --shadow-sm: 0 1px 3px rgba(var(--shade-rgb), 0.08);
  --shadow-md: 0 8px 24px rgba(var(--shade-rgb), 0.16);
  --shadow-overlay: 0 18px 48px rgba(var(--shade-rgb), 0.28);
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
`;

// The same roles at night. Only colours change: a surface is darker the
// further back it sits (--paper-sunken, --paper, --card), text is light, and
// every saturated fill is lighter so --ink-inverse (now dark) stays AA on
// it. PDF pages keep --page white: a paper is printed in black on white,
// and its figures, highlights and ink are drawn for that.
export const darkTokens = `
  color-scheme: dark;

  --ink: #e3e6eb;
  --ink-soft: #b2b9c4;
  /* AA on --paper and on --card. */
  --ink-faint: #8f98a6;

  --paper: #15181d;
  --paper-sunken: #111418;
  --card: #1d2128;
  --line: #2f353e;
  --line-strong: #4a535f;
  --ink-inverse: #10151c;

  --fill: #3a424d;
  --fill-strong: #4d5663;

  --accent: #7ea6d8;
  --accent-strong: #a3c1e6;
  --accent-soft: #1f2a38;
  --accent-line: #35485f;
  --accent-band: #223852;
  --accent-band-ink: #e3e6eb;
  --focus: #7ea6d8;
  --focus-soft: rgba(126, 166, 216, 0.3);

  --gold: #d2b061;
  --gold-ink: #e3c787;
  --gold-soft: #2a2517;
  --gold-line: #4b4024;
  --green: #8fbb80;
  --green-ink: #aed29f;
  --green-soft: #1b2519;
  --green-line: #34472e;
  --red: #e5806f;
  --red-soft: #2f1c1a;
  --red-line: #5c312b;

  --identity-0: #7ea6d8;
  --identity-1: #72aab4;
  --identity-2: #8db495;
  --identity-3: #d4937b;
  --identity-4: #c290b4;
  --identity-5: #9a9fd6;

  --activity-paper-1: #4f97ec;
  --activity-paper-2: #f08355;
  --activity-paper-3: #30c08c;
  --activity-paper-4: #8d7fe6;
  --activity-other: #4a535f;
  --activity-heat-1: #1f2a38;
  --activity-heat-2: #2b3f59;
  --activity-heat-3: #3f6290;
  --activity-heat-4: #6690c6;
  --activity-heat-5: #9dbde6;
  --read-age-1: #252a32;
  --read-age-2: #2f353e;

  --shade-rgb: 0, 0, 0;
  --accent-rgb: 126, 166, 216;
  --ink-rgb: 227, 230, 235;
  --page: #ffffff;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-overlay: 0 18px 48px rgba(0, 0, 0, 0.6);
`;

// The theme a page wears: the light tokens, then the dark ones when the
// system is dark and the member has not chosen light here, or when they
// chose dark (shared/theme.js sets data-theme on <html>). `light` and
// `dark` are a surface's own extra tokens for each.
export function themedTokens(light = '', dark = '') {
  return `
:root {
  ${designTokens}
  ${light}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    ${darkTokens}
    ${dark}
  }
}
:root[data-theme='dark'] {
  ${darkTokens}
  ${dark}
}
`;
}

// Rules for the dark theme only, for the few colours that are a component's
// own rather than a token: `rules` is [[selector, declarations], ...].
export function inDark(rules) {
  const under = (prefix) => rules.map(([selector, declarations]) => `${selector.split(',').map((one) => `${prefix} ${one.trim()}`).join(', ')} { ${declarations} }`).join('\n');
  return `
@media (prefers-color-scheme: dark) {
${under(":root:not([data-theme='light'])")}
}
${under(":root[data-theme='dark']")}
`;
}
