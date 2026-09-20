import React from 'react';
import ReactDOM from 'react-dom/client';
import './configurePlatform.js';
import '../../shared/desktopShell';
import './readableStreamIteration';
import App, { preloadPdfPage } from './App';
import ErrorBoundary from '../../shared/ui/ErrorBoundary.jsx';
import { hydrateCredential } from '../../shared/credentials.js';
import { markViewerPerformance } from './performance.js';
import { styles } from './styles.js';

markViewerPerformance('bootstrap');

// Install the viewer's layout before React mounts. Injecting this large sheet
// as a React <style> child is unreliable in embedded WebKit: the node can be
// present while its rules are not applied, leaving the high-DPI PDF canvas at
// its intrinsic pixel width. A constructed sheet avoids that path.
const viewerSheet = new CSSStyleSheet();
viewerSheet.replaceSync(styles);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, viewerSheet];

// hydrateCredential reads localStorage synchronously before returning its
// already-resolved promise. Do not make the whole entry module wait through a
// top-level-await turn before mounting the real viewer controls.
void hydrateCredential().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary area="the viewer">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Let the browser paint the functional React chrome once, then fetch and
// evaluate the much larger page renderer while PDF.js opens the document.
// The nested task matters for a warm cache: module evaluation must not sneak
// into the same pre-paint turn as the toolbar commit.
requestAnimationFrame(() => setTimeout(() => {
  void preloadPdfPage().catch(() => {});
}, 0));
