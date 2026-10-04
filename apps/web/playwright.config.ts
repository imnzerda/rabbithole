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
      // Serveur de jeu de test : base en mémoire, fantôme rapide, données de test, SMS lus par une route de test.
      command: 'pnpm --filter @rabbithole/server start',
      url: 'http://localhost:3000/api/health',
      env: {
        PORT: '3000',
        PGLITE_DIR: '',
        GHOST_DELAY_MS: '1500',
        LOG_LEVEL: 'warn',
        TEST_FIXTURES: '1',
        // Tous les tests s'inscrivent depuis la même IP locale, en parallèle.
        SIGNUP_PER_IP_PER_MINUTE: '1000',
        SIGNUP_PER_SUBNET_PER_MINUTE: '1000',
        SMS_PER_IP_PER_HOUR: '1000',
        AUTH_RATE_LIMIT: '1000',
        // Pas d'appel à Wikimedia pendant les tests (Tendance du jour).
        TRENDING: 'off',
        // Compte administrateur des tests de l'outil d'admin.
        ADMIN_EMAILS: 'admin-e2e@example.com',
      },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Outil d'administration (apps/admin).
      command: 'pnpm --filter @rabbithole/admin dev',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
