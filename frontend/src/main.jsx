import React from 'react'
import ReactDOM from 'react-dom/client'
import './configurePlatform.js'
import '../../shared/desktopShell'
import App from './App.jsx'
import { hydrateCredential } from '../../shared/credentials.js'
import { getStartupUser } from '../../shared/api/account.js'

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
