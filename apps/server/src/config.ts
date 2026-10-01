import type { Rarity } from '@rabbithole/engine';

/** Valeurs d'économie (sections 6.2 et 6.3) : jamais codées en dur ailleurs. */
export interface EconomyConfig {
  /** Boosters gratuits (contenu aléatoire) offerts à l'inscription. */
  welcomeBoosters: number;
  boosterSize: number;
  /** Prix d'un booster à aperçu, en pièces. */
  boosterPrice: number;
  /** Sans achat, l'aperçu se renouvelle automatiquement après ce délai. */
  previewRefreshHours: number;
  /** Poids de tirage de la rareté de chaque carte d'un booster (probabilités affichées). */
  rarityWeights: Record<Rarity, number>;
  /** Exemplaires conservés : on ne recycle qu'au-delà, on ne fabrique que jusque-là. */
  keepCopies: number;
  recycle: Record<Rarity, number>;
  craft: Record<Rarity, number>;
  /** Pièces gagnées en fin de partie en ligne, et plafond journalier. */
  rewards: { win: number; loss: number; draw: number; dailyCap: number };
}

/** Configuration du serveur, lue depuis l'environnement. */
export interface ServerConfig {
  port: number;
  host: string;
  /** URL PostgreSQL (production : Neon). `null` → PGlite embarqué (développement, tests). */
  databaseUrl: string | null;
  /** Dossier de données PGlite. `null` ou vide → base en mémoire (tests). */
  pgliteDir: string | null;
  sessionDays: number;
  /** Cookie `Secure` (HTTPS) : activé en production. */
  cookieSecure: boolean;
  /** Faire confiance à `X-Forwarded-For` : uniquement derrière un proxy de confiance (production). */
  trustProxy: boolean;
  /** Sel des empreintes d'IP et d'appareil (jamais stockées en clair). */
  signalSalt: string;
  /**
   * Anti-double compte : un HWID déjà connu bloque l'inscription seulement depuis la même IP
   * (false, par défaut : deux téléphones du même modèle peuvent avoir le même HWID),
   * ou partout (true).
   */
  hwidStrict: boolean;
  /** Domaines d'e-mails jetables refusés à l'inscription. */
  disposableDomains: string[];
  /** Attente avant de proposer un adversaire fantôme (matchmaking). */
  ghostDelayMs: number;
  /** Minuteurs de décision côté serveur. `null` → valeurs des règles du jeu. */
  turnTimerMs: number | null;
  reactionTimerMs: number | null;
  /** Requêtes d'authentification autorisées par minute et par IP. */
  authRateLimit: number;
  /** Route de données de test (`/api/test/*`). Jamais en production. */
  testFixtures: boolean;
  economy: EconomyConfig;
  logLevel: string;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  welcomeBoosters: 6,
  boosterSize: 5,
  boosterPrice: 100,
  previewRefreshHours: 24,
  rarityWeights: { basique: 55, tendance: 27, viral: 12, iconique: 5, goat: 1 },
  keepCopies: 2,
  recycle: { basique: 5, tendance: 12, viral: 40, iconique: 120, goat: 400 },
  craft: { basique: 20, tendance: 50, viral: 150, iconique: 500, goat: 1500 },
  rewards: { win: 40, loss: 15, draw: 20, dailyCap: 400 },
};

/** Fournisseurs d'e-mails jetables courants (liste complétée en production). */
const DISPOSABLE = ['mailinator.com', 'yopmail.com', 'guerrillamail.com', 'trashmail.com', '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com'];

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  if (production && !env.SIGNAL_SALT) throw new Error('SIGNAL_SALT est obligatoire en production.');
  if (production && env.TEST_FIXTURES === '1') throw new Error('TEST_FIXTURES est interdit en production.');
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR ?? (production ? null : '.data/pglite'),
    sessionDays: int(env.SESSION_DAYS, 30),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === 'true' : false,
    signalSalt: env.SIGNAL_SALT ?? 'dev-only-salt',
    hwidStrict: env.HWID_STRICT === 'true',
    disposableDomains: env.DISPOSABLE_DOMAINS ? env.DISPOSABLE_DOMAINS.split(',') : DISPOSABLE,
    ghostDelayMs: int(env.GHOST_DELAY_MS, 15_000),
    turnTimerMs: env.TURN_TIMER_MS ? int(env.TURN_TIMER_MS, 60_000) : null,
    reactionTimerMs: env.REACTION_TIMER_MS ? int(env.REACTION_TIMER_MS, 20_000) : null,
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    testFixtures: !production && env.TEST_FIXTURES === '1',
    economy: DEFAULT_ECONOMY,
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'warn'),
  };
}

/** Configuration de test : base en mémoire, pas de minuteurs, fantôme lent, limites larges. */
export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    pgliteDir: null,
    databaseUrl: null,
    ghostDelayMs: 60_000,
    turnTimerMs: 3_600_000,
    reactionTimerMs: 3_600_000,
    authRateLimit: 1000,
    testFixtures: true,
    logLevel: 'silent',
    ...overrides,
  };
}
