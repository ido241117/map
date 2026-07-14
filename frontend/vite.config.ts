import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Repo root — shared `.env` / `.env.example` (not frontend/). */
const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  // Expose zoom knobs (+ VITE_*) from root .env to the client — one name each, no VITE_ duplicate.
  envPrefix: [
    'VITE_',
    'LAND_PARCELS_',
    'PARCELS_GEOMETRY_',
    'HOUSE_NO_',
    'QHSDD_',
    'HIGHWAYS_',
  ],
  server: {
    port: 5173,
    host: true,
    // Cloudflare Tunnel (Host header ≠ localhost) — Vite 6+ blocks otherwise
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
