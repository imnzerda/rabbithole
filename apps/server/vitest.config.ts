import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // Chaque fichier démarre sa base (PGlite) et applique les migrations : plus lent quand tout tourne en parallèle.
    hookTimeout: 60_000,
  },
});
