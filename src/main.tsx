import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './App'
import { DemoPage } from './components/DemoPage'

registerSW()

// Tiny path-based router so /demo serves the autoplaying walkthrough
// without pulling in a routing library. Anything else falls through to
// the redactor app.
const isDemo = typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/demo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDemo ? <DemoPage /> : <App />}
  </StrictMode>,
)
