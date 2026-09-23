// The panel that covers a window when the service will no longer talk to
// this build (shared/ui/CompatibilityGate.jsx). In one place because two
// stylesheets show it: the library and board build from
// shared/applicationStyles.js, the viewer from its own viewer/src/styles.js,
// and a panel with rules in only the first reached the viewer unstyled.
export const compatibilityStyles = `
/* A build the service will not speak to covers its window rather than
   banding it: what is wrong is the program, and there is nothing useful
   left to do in it. */
.compatibility-stop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ink) 82%, transparent);
  font-family: var(--font-ui);
}

.compatibility-stop-panel {
  max-width: 420px;
  padding: 28px 30px;
  border-radius: var(--radius-lg);
  background: var(--paper, #fff);
  color: var(--ink);
  box-shadow: 0 18px 50px rgb(0 0 0 / 35%);
}

.compatibility-stop-panel h1 {
  margin: 0 0 12px;
  font-size: var(--fs-lg);
}

.compatibility-stop-panel p {
  margin: 0 0 12px;
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.compatibility-stop-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
}

.compatibility-stop-actions a {
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
}
`;
