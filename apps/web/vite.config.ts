import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** En développement, `/api` et `/ws` sont relayés vers le serveur : même origine, cookies de session compris. */
const SERVER = process.env.RH_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
