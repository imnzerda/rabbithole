import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** `/api` est relayé vers le serveur de jeu : même origine, même cookie de session que le site. */
const SERVER = process.env.RH_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: SERVER, changeOrigin: false } },
  },
});
