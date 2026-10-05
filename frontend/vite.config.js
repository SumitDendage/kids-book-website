import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/* Two pages, like the original site:
   index.html  → the customer site (+ /admin and /developer, loaded on demand)
   viewer.html → the protected sheet viewer, kept as its own page so the old
                 links (viewer.html#t=…) keep working and it loads none of the site. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  /* `npm run dev` forwards /api/* to the Node backend when one is running
     (npm start in backend/ listens on 127.0.0.1:4173). Production never uses this. */
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
