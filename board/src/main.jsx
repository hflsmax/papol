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

// Light or dark, as chosen on this device, before anything is drawn.
followTheme();

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
