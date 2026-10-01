/** Configuration du serveur, lue depuis l'environnement. Rien n'est codé en dur ailleurs. */
export interface ServerConfig {
  port: number;
  host: string;
  /** URL PostgreSQL (production : Neon). `null` → PGlite embarqué (développement, tests). */
  databaseUrl: string | null;
  /** Dossier de données PGlite. `null` → base en mémoire (tests). */
  pgliteDir: string | null;
  /** Âge minimum pour créer un compte (CGU 21+). */
  minAge: number;
  sessionDays: number;
  /** Cookie `Secure` (HTTPS) : activé en production. */
  cookieSecure: boolean;
  /** Attente avant de proposer un adversaire fantôme (matchmaking). */
  ghostDelayMs: number;
  /** Minuteurs de décision côté serveur. `null` → valeurs des règles du jeu. */
  turnTimerMs: number | null;
  reactionTimerMs: number | null;
  /** Requêtes d'authentification autorisées par minute et par IP. */
  authRateLimit: number;
  logLevel: string;
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR ?? (production ? null : '.data/pglite'),
    minAge: int(env.MIN_AGE, 21),
    sessionDays: int(env.SESSION_DAYS, 30),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    ghostDelayMs: int(env.GHOST_DELAY_MS, 15_000),
    turnTimerMs: env.TURN_TIMER_MS ? int(env.TURN_TIMER_MS, 60_000) : null,
    reactionTimerMs: env.REACTION_TIMER_MS ? int(env.REACTION_TIMER_MS, 20_000) : null,
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'warn'),
  };
}

/** Configuration de test : base en mémoire, pas de minuteurs, fantôme rapide. */
export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    pgliteDir: null,
    databaseUrl: null,
    ghostDelayMs: 60_000,
    turnTimerMs: 3_600_000,
    reactionTimerMs: 3_600_000,
    authRateLimit: 1000,
    logLevel: 'silent',
    ...overrides,
  };
}
