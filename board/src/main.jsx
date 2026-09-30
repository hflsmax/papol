import React from 'react';
import ReactDOM from 'react-dom/client';
import './configurePlatform.js';
import '../../shared/desktopShell';
import { startFeedbackTrail } from '../../shared/feedbackTrail.js';
import App from './App.jsx';
import ErrorBoundary from '../../shared/ui/ErrorBoundary.jsx';
import { hydrateCredential } from '../../shared/credentials.js';

// Every report says what its writer had just done.
startFeedbackTrail('board');

await hydrateCredential().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary area="the board">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
