import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { registerAnalyticsSink, track, type AnalyticsEvent } from './lib/analytics'
import { configuredProvider } from './lib/analyticsProviders'
import { visitOncePerSession } from './lib/visitor'

// Development event log: every analytics event is kept on window so the
// funnel can be checked by hand or by the e2e suite. Never in production.
if (import.meta.env.DEV) {
  const log: AnalyticsEvent[] = []
  ;(window as unknown as { __ctAnalytics: AnalyticsEvent[] }).__ctAnalytics = log
  registerAnalyticsSink((event) => {
    log.push(event)
  })
}

// The analytics provider, when one is configured for this build (F05).
const provider = configuredProvider(import.meta.env)
if (provider) registerAnalyticsSink(provider)

const visit = visitOncePerSession()
if (visit) track({ name: 'visit_started', ...visit })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
