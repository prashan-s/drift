import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One application, two views (#/audit and #/graph) — a single entry point.
//
// Assets are referenced relatively so the same build runs from a domain root
// and from a GitHub Pages project path (/drift/) without rebuilding. Routing is
// hash-based, so no server rewrite rules are needed either.
export default defineConfig({
  base: './',
  plugins: [react()],
})
