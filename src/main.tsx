import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { config } from '@fortawesome/fontawesome-svg-core'
import '@fortawesome/fontawesome-svg-core/styles.css'
import Shell from './Shell'
import './styles.css'

// Font Awesome injects its own <style> at runtime by default, which races the
// bundled stylesheet and flashes oversized icons on first paint.
config.autoAddCss = false

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
