import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA : le jeu tourne entièrement côté client (Cloudflare Pages).
    adapter: adapter({ fallback: 'index.html' }),
  },
};
