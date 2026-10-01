import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5173', locale: 'fr-FR' },
  // Chaque test tourne sur smartphone (disposition portrait) et sur PC (disposition paysage).
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1600, height: 900 } } },
  ],
  webServer: [
    {
      // Serveur de jeu avec une base en mémoire (PGlite) et un fantôme rapide.
      command: 'pnpm --filter @rabbithole/server start',
      url: 'http://localhost:3000/api/health',
      env: { PORT: '3000', PGLITE_DIR: '', GHOST_DELAY_MS: '1500', LOG_LEVEL: 'warn' },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
