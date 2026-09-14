import React from 'react';
import ReactDOM from 'react-dom/client';
import './configurePlatform.js';
import '../../shared/desktopShell';
import './readableStreamIteration';
import App from './App';
import { hydrateCredential } from '../../shared/credentials.js';
import { markViewerPerformance } from './performance.js';
import { styles } from './styles.js';

markViewerPerformance('bootstrap');

// Install the viewer's layout before React mounts. Injecting this large sheet
// as a React <style> child is unreliable in embedded WebKit: the node can be
// present while its rules are not applied, leaving the high-DPI PDF canvas at
// its intrinsic pixel width. Constructed sheets avoid that path; the fallback
// covers older browsers that do not implement adoptedStyleSheets.
if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
  const viewerSheet = new CSSStyleSheet();
  viewerSheet.replaceSync(styles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, viewerSheet];
} else {
  const viewerStyle = document.createElement('style');
  viewerStyle.textContent = styles;
  document.head.append(viewerStyle);
}

await hydrateCredential().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
