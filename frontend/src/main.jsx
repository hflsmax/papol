import React from 'react'
import ReactDOM from 'react-dom/client'
import './configurePlatform.js'
import '../../shared/desktopShell'
import App from './App.jsx'
import { hydrateCredential } from '../../shared/credentials.js'

await hydrateCredential().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
