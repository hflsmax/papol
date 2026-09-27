import React from 'react'
import ReactDOM from 'react-dom/client'
import './configurePlatform.js'
import '../../shared/desktopShell'
// Its document-wide listener gives Papol macOS a native app's quiet
// right-click wherever no menu of its own is offered.
import '../../shared/contextMenu'
import App from './App.jsx'
import { hydrateCredential } from '../../shared/credentials.js'
import { getStartupUser } from '../../shared/api/account.js'
import { startDesktopMediaHydration } from '../../shared/desktopMedia.js'

void startDesktopMediaHydration()

let startupError = null
await hydrateCredential().catch((error) => { startupError = error })
const startupUser = await getStartupUser().catch((error) => {
  startupError ||= error
  return null
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App startupUser={startupUser} startupError={startupError} />
  </React.StrictMode>,
)
