import React from 'react';
import ReactDOM from 'react-dom/client';
import { followTheme } from '../../shared/theme.js';
import './configurePlatform.js';
import '../../shared/desktopShell';
import { startFeedbackTrail } from '../../shared/feedbackTrail.js';
import App from './App.jsx';
import ErrorBoundary from '../../shared/ui/ErrorBoundary.jsx';
import { hydrateCredential } from '../../shared/credentials.js';
import { startSharingUserState } from '../../shared/featureStates.js';
import { applicationStyles } from '../../shared/applicationStyles.js';
import { addPageStyles } from '../../shared/pageStyles.js';

// Light or dark, as chosen on this device, before anything is drawn.
followTheme();

// The application's stylesheet, before React mounts, as a constructed sheet.
// The page's HTML carries an inline <style> (the dark background until this
// arrives), which Tauri hashes into the window's Content-Security-Policy,
// and under a hashed style-src WebKit applies none of a <style> element
// added later: Papol for Mac drew this page bare (shared/pageStyles.js).
addPageStyles('papol-application', applicationStyles, { first: true });

// Every report says what its writer had just done.
startFeedbackTrail('board');

await hydrateCredential().catch(() => {});
startSharingUserState();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary area="the board">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
