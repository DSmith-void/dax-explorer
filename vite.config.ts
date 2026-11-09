import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Listen on the loopback address only, so the dev and preview servers are
  // reachable from this computer but never from other machines on the network.
  // Do not change this to `true` / `0.0.0.0` (or run with `--host`) without a
  // deliberate reason.
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
})
