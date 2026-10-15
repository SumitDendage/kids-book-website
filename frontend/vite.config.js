import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/* Two pages, like the original site:
   index.html  → the customer site (+ /admin and /developer, loaded on demand)
   viewer.html → the protected sheet viewer, kept as its own page so the old
                 links (viewer.html#t=…) keep working and it loads none of the site. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  /* The site calls the API at VITE_API_BASE_URL (see src/services/api.js). Empty means the live
     Supabase API, and any full address is called the same way: straight from the browser, so this
     forwarding is not used. Only when VITE_API_BASE_URL is "/" (or "same-origin") do the calls go
     to /api/* on this server; then `npm run dev` and `npm run preview` forward them to
     VITE_DEV_API_PROXY (default http://127.0.0.1:4173, where the old Node backend listened).
     The built site never uses this. */
  const apiTarget = env.VITE_DEV_API_PROXY || 'http://127.0.0.1:4173';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: {
      port: 4174,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          viewer: resolve(import.meta.dirname, 'viewer.html'),
        },
      },
    },
  };
});
