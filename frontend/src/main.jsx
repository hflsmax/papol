import React from 'react'
import ReactDOM from 'react-dom/client'
import './configurePlatform.js'
import '../../shared/desktopShell'
import App from './App.jsx'
import { hydrateCredential } from '../../shared/credentials.js'
import { getStartupUser } from '../../shared/api/account.js'

await hydrateCredential().catch(() => {})
const startupUser = await getStartupUser().catch(() => null)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App startupUser={startupUser} />
  </React.StrictMode>,
)
