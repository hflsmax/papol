import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../shared/desktopShell';
import './readableStreamIteration';
import App from './App';
import { hydrateCredential } from '../../shared/credentials.js';

await hydrateCredential().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
