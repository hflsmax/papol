// Canonical visual foundations shared by every Papol surface. Keep
// component-specific runtime properties (shelf colors, PDF brush colors,
// board zoom) in their components; everything with a product-wide role lives
// here so the library, board, desktop shell, and viewer cannot drift.
export const designTokens = `
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
  --grey: #8a94a2;

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
  --shadow-sm: 0 1px 3px rgba(29, 33, 41, 0.08);
  --shadow-md: 0 8px 24px rgba(29, 33, 41, 0.16);
  --shadow-overlay: 0 18px 48px rgba(29, 33, 41, 0.28);
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
`;
