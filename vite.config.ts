import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// During development (`npm run dev`), requests to /api are forwarded to the local helper, adding the
// token from the DAXEXPLORER_HELPER_TOKEN environment variable (start the helper with the same value).
// Without the helper running, the app simply stays in symbolic mode.
const helperToken = process.env.DAXEXPLORER_HELPER_TOKEN

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Listen on the loopback address only, so the dev and preview servers are
  // reachable from this computer but never from other machines on the network.
  // Do not change this to `true` / `0.0.0.0` (or run with `--host`) without a
  // deliberate reason.
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5092',
        headers: helperToken ? { 'X-DaxExplorer-Token': helperToken } : {},
      },
    },
  },
  preview: { host: '127.0.0.1' },
})
