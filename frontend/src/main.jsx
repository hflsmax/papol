import React from 'react'
import ReactDOM from 'react-dom/client'
import './configurePlatform.js'
import '../../shared/desktopShell'
import { startFeedbackTrail } from '../../shared/feedbackTrail.js'
// Papol macOS stays quiet on right-click, as a native app does.
import '../../shared/contextMenu'
import App from './App.jsx'
import { FacesLead } from '../../shared/ui/Face.jsx'
import { hydrateCredential } from '../../shared/credentials.js'
import { getStartupUser } from '../../shared/api/account.js'
import { startDesktopMediaHydration } from '../../shared/desktopMedia.js'

// Every report says what its writer had just done.
startFeedbackTrail('nook')

void startDesktopMediaHydration()

let startupError = null
await hydrateCredential().catch((error) => { startupError = error })
const startupUser = await getStartupUser().catch((error) => {
  startupError ||= error
  return null
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FacesLead.Provider value={true}>
      <App startupUser={startupUser} startupError={startupError} />
    </FacesLead.Provider>
  </React.StrictMode>,
)
