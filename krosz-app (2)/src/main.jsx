import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Mount React first so the homepage paints immediately. The public brand guard
// is loaded afterwards (dynamic import) so its MutationObserver never attaches
// before/around React's first commit and can never block or delay initial
// render — which was the pre-render side-effect most likely blanking the home
// page in the preview.
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Brand guard runs after React mounts so it never delays or blocks first paint.
import('@/lib/publicBrandGuard')
  .then(({ installPublicBrandGuard }) => {
    try { installPublicBrandGuard() } catch (e) { /* best-effort; never block the app */ }
  })
  .catch(() => { /* guard is optional */ })