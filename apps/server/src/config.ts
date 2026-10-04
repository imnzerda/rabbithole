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
  /** Trade-up (section 6.4) : doublons de même rareté pour une carte de la rareté supérieure ; davantage pour choisir la catégorie. */
  tradeUp: { count: number; targetedCount: number };
  /** Échanges entre amis (section 6.5), sans limite : seulement la durée de validité d'une proposition. */
  trades: { expiryHours: number };
}

/** Vérification par SMS : jamais, seulement pour les inscriptions à risque (VPN, appareil connu ailleurs), ou toujours. */
export type SmsMode = 'off' | 'risky' | 'always';

/** Protection de l'inscription contre les robots et les doubles comptes (section 14). */
export interface GuardConfig {
  /** Cloudflare Turnstile (captcha invisible). Sans clés : désactivé (développement, tests). */
  turnstile: { siteKey: string; secret: string } | null;
  /** Tentatives d'inscription par minute, par IP et par sous-réseau (/24 en IPv4, /64 en IPv6). */
  signupPerIpPerMinute: number;
  signupPerSubnetPerMinute: number;
  /** Durée du blocage temporaire quand une limite est dépassée. */
  signupBlockMinutes: number;
  /** Liste d'e-mails jetables téléchargée et rafraîchie chaque jour, en plus de la liste embarquée. */
  disposableListUrl: string | null;
  /** Domaines jetables ajoutés à la main. */
  disposableExtra: string[];
  smsMode: SmsMode;
  /** Envoi des SMS (Twilio). Sans identifiants : les codes sont écrits dans le journal du serveur (développement). */
  twilio: { accountSid: string; authToken: string; from: string } | null;
  /** Pays dont les numéros sont acceptés (limite la fraude aux SMS surtaxés). */
  smsCountries: string[];
  smsCodeMinutes: number;
  smsMaxAttempts: number;
  smsPerPhonePerHour: number;
  smsPerIpPerHour: number;
  /** Détection de VPN et de proxys (proxycheck.io). `null` : désactivée. */
  proxycheck: { key: string | null } | null;
}

/**
 * Paiements (section 14). Le prestataire réel n'est pas encore choisi : `sandbox` simule un prestataire
 * (page de paiement factice et webhooks signés) en développement et en test ; il est interdit en production.
 * `none` : boutique fermée.
 */
export interface PaymentsConfig {
  provider: 'sandbox' | 'none';
  /** Secret HMAC des webhooks du prestataire sandbox. */
  sandboxSecret: string;
}

/** Ce que compte une mission (section 13), toujours mesuré côté serveur. */
export type MissionKind = 'play' | 'win' | 'play_cards' | 'play_category' | 'open_booster' | 'trade_up' | 'trade' | 'craft';

export interface MissionTemplate {
  kind: MissionKind;
  target: number;
  /** Pièces gagnées en réclamant la mission. */
  coins: number;
  /** Points de pass (le pass saisonnier viendra ensuite). */
  xp: number;
}

/** Missions quotidiennes et hebdomadaires : nombre tiré pour chaque joueur et modèles possibles. */
export interface MissionsConfig {
  dailyCount: number;
  weeklyCount: number;
  daily: MissionTemplate[];
  weekly: MissionTemplate[];
}

export const DEFAULT_MISSIONS: MissionsConfig = {
  dailyCount: 3,
  weeklyCount: 3,
  daily: [
    { kind: 'play', target: 3, coins: 40, xp: 100 },
    { kind: 'win', target: 2, coins: 60, xp: 150 },
    { kind: 'play_cards', target: 15, coins: 40, xp: 100 },
    { kind: 'play_category', target: 8, coins: 50, xp: 120 },
    { kind: 'open_booster', target: 1, coins: 30, xp: 80 },
  ],
  weekly: [
    { kind: 'play', target: 15, coins: 200, xp: 500 },
    { kind: 'win', target: 10, coins: 300, xp: 700 },
    { kind: 'play_category', target: 40, coins: 250, xp: 600 },
    { kind: 'trade_up', target: 1, coins: 150, xp: 400 },
    { kind: 'trade', target: 1, coins: 150, xp: 400 },
    { kind: 'craft', target: 1, coins: 100, xp: 300 },
  ],
};

/** Variantes cosmétiques de cartes (section 6.6) : même carte, mêmes stats, autre apparence. */
export const CARD_VARIANTS = ['holo', 'gold', 'glitch', 'negative', 'vhs', 'pixel'] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

/**
 * Pass saisonnier (section 6.6) : saisons de 28 jours comptées depuis `epoch`, niveaux par points de pass.
 * Piste gratuite pour tous ; pistes premium et deluxe achetées en argent réel (produits `pass_*`).
 * Les récompenses des pistes payantes ne sont jamais aléatoires ni un avantage de jeu : cosmétiques et
 * boosters à aperçu (contenu exact affiché avant l'ouverture).
 */
export interface PassConfig {
  /** Début de la saison 1 (minuit UTC). */
  epoch: string;
  seasonDays: number;
  tiers: number;
  xpPerTier: number;
  /** Points de pass en fin de partie en ligne. */
  matchXp: { win: number; loss: number; draw: number };
  /** Piste gratuite : pièces à chaque niveau, booster gratuit (aléatoire) tous les `freeBoosterEvery` niveaux. */
  freeCoins: number;
  freeBoosterEvery: number;
  /** Piste premium : booster à aperçu tous les `premiumBoosterEvery` niveaux, variantes sinon. */
  premiumBoosterEvery: number;
  /** Variantes de la piste premium ; la piste deluxe donne les autres (exclusives). */
  premiumVariants: CardVariant[];
  deluxeVariants: CardVariant[];
}

export const DEFAULT_PASS: PassConfig = {
  epoch: '2026-10-01',
  seasonDays: 28,
  tiers: 30,
  xpPerTier: 1000,
  matchXp: { win: 120, loss: 60, draw: 80 },
  freeCoins: 30,
  freeBoosterEvery: 5,
  premiumBoosterEvery: 3,
  premiumVariants: ['holo', 'gold', 'pixel'],
  deluxeVariants: ['glitch', 'negative', 'vhs'],
};

/**
 * Classé (section 7) : saisons mensuelles (mois UTC), rangs par points de classement (multipliés par l'enjeu
 * de la partie : Hype, section 3.4). Une défaite ne fait
 * jamais redescendre sous le seuil du rang atteint. Nouvelle saison : une part des points est conservée
 * (reset partiel), et le meilleur rang de la saison passée donne une récompense.
 */
export interface RankedConfig {
  ranks: { id: string; min: number; reward: { coins: number; title: boolean } }[];
  win: number;
  loss: number;
  draw: number;
  /** Part des points conservée d'une saison à la suivante. */
  carry: number;
  /** Taille des classements (top N mondial et par pays). */
  leaderboardSize: number;
}

export const DEFAULT_RANKED: RankedConfig = {
  ranks: [
    { id: 'lurker', min: 0, reward: { coins: 0, title: false } },
    { id: 'normie', min: 100, reward: { coins: 100, title: false } },
    { id: 'posteur', min: 300, reward: { coins: 250, title: false } },
    { id: 'influenceur', min: 600, reward: { coins: 500, title: false } },
    { id: 'viral', min: 1000, reward: { coins: 1000, title: true } },
    { id: 'legende', min: 1500, reward: { coins: 2000, title: true } },
  ],
  win: 25,
  loss: 15,
  draw: 5,
  carry: 0.5,
  leaderboardSize: 1000,
};

/** Ce que mesure un succès (section 13), toujours calculé côté serveur à partir des données du joueur. */
export type AchievementMetric = 'games' | 'wins' | 'ranked_wins' | 'best_rank_points' | 'cards' | 'goats' | 'boosters' | 'trade_ups' | 'trades' | 'friends';

export interface AchievementDef {
  id: string;
  metric: AchievementMetric;
  target: number;
  coins: number;
  /** Titre de profil débloqué (les succès les plus durs). */
  title?: Record<string, string>;
}

/**
 * Succès et progression de collection (section 13). Les succès « Spécialiste » (posséder toutes les cartes
 * d'une catégorie) sont générés pour chaque catégorie (`specialist`). Progression de collection : chaque
 * carte nouvelle et chaque partie en ligne font avancer une barre ; chaque niveau donne une récompense.
 */
export interface AchievementsConfig {
  list: AchievementDef[];
  specialist: { coins: number };
  collection: { pointsPerCard: number; pointsPerGame: number; pointsPerLevel: number; reward: { coins: number; freeBoosters: number } };
}

export const DEFAULT_ACHIEVEMENTS: AchievementsConfig = {
  list: [
    { id: 'games_1', metric: 'games', target: 1, coins: 20 },
    { id: 'games_10', metric: 'games', target: 10, coins: 60 },
    { id: 'games_100', metric: 'games', target: 100, coins: 300, title: { fr: 'Accro du terrier', en: 'Rabbit hole regular' } },
    { id: 'wins_1', metric: 'wins', target: 1, coins: 30 },
    { id: 'wins_25', metric: 'wins', target: 25, coins: 150 },
    { id: 'wins_100', metric: 'wins', target: 100, coins: 500, title: { fr: 'Cent victoires', en: 'Hundred wins' } },
    { id: 'ranked_wins_25', metric: 'ranked_wins', target: 25, coins: 250 },
    { id: 'rank_legend', metric: 'best_rank_points', target: 1500, coins: 500, title: { fr: 'Au sommet', en: 'At the top' } },
    { id: 'cards_25', metric: 'cards', target: 25, coins: 50 },
    { id: 'cards_100', metric: 'cards', target: 100, coins: 200 },
    { id: 'cards_200', metric: 'cards', target: 200, coins: 500, title: { fr: 'Encyclopédiste', en: 'Encyclopedist' } },
    { id: 'goats_1', metric: 'goats', target: 1, coins: 100 },
    { id: 'goats_5', metric: 'goats', target: 5, coins: 400, title: { fr: 'Chasse aux GOAT', en: 'GOAT hunter' } },
    { id: 'boosters_10', metric: 'boosters', target: 10, coins: 50 },
    { id: 'boosters_50', metric: 'boosters', target: 50, coins: 200 },
    { id: 'trade_ups_1', metric: 'trade_ups', target: 1, coins: 40 },
    { id: 'trade_ups_10', metric: 'trade_ups', target: 10, coins: 150 },
    { id: 'trades_1', metric: 'trades', target: 1, coins: 40 },
    { id: 'trades_10', metric: 'trades', target: 10, coins: 150, title: { fr: 'Marché aux puces', en: 'Flea market' } },
    { id: 'friends_1', metric: 'friends', target: 1, coins: 30 },
    { id: 'friends_5', metric: 'friends', target: 5, coins: 100 },
  ],
  specialist: { coins: 300 },
  collection: { pointsPerCard: 10, pointsPerGame: 2, pointsPerLevel: 200, reward: { coins: 50, freeBoosters: 1 } },
};

/**
 * Tendance du jour (section 8) : chaque jour à `computeHour` UTC, vues Wikipédia de la veille comparées à
 * la moyenne des 30 jours précédents ; les `count` meilleures cartes (au moins `minViews` vues) gagnent le
 * bonus Tendance pour 24 h. Publication automatique à `publishHour`:`publishMinute` UTC, après une fenêtre où
 * l'admin peut écarter une carte. Exclues d'office : liste de surveillance, décès depuis moins de `recentDeathDays` jours.
 */
export interface TrendingConfig {
  /** false : aucun calcul (tests, ou `TRENDING=off`). */
  enabled: boolean;
  count: number;
  minViews: number;
  computeHour: number;
  publishHour: number;
  publishMinute: number;
  recentDeathDays: number;
  languages: string[];
}

export const DEFAULT_TRENDING: Omit<TrendingConfig, 'enabled'> = {
  count: 10,
  minViews: 1000,
  computeHour: 6,
  publishHour: 6,
  publishMinute: 30,
  recentDeathDays: 30,
  languages: ['en', 'fr'],
};

/**
 * Défi du jour (section 7) : deck imposé et adversaire IA identiques pour tous, même seed, une tentative
 * comptée par jour. Score : victoire, Vies restantes, Vies prises à l'adversaire, moins les tours joués.
 */
export interface DailyConfig {
  score: { win: number; lifeLeft: number; lifeTaken: number; perTurn: number };
  reward: { win: number; loss: number };
  leaderboardSize: number;
}

export const DEFAULT_DAILY: DailyConfig = {
  score: { win: 1000, lifeLeft: 100, lifeTaken: 50, perTurn: 10 },
  reward: { win: 60, loss: 20 },
  leaderboardSize: 20,
};

/**
 * Draft du week-end (section 7) : le joueur choisit un Leader parmi quelques-uns, puis ses cartes une à une
 * parmi des propositions, et joue avec ce deck jusqu'à `maxWins` victoires ou `maxLosses` défaites.
 * Entrée gratuite une fois par week-end, sinon en pièces. Les cartes choisies ne sont pas gardées : la récompense
 * dépend du nombre de victoires.
 */
export interface DraftConfig {
  /** Jours d'ouverture (UTC, 0 = dimanche). Une partie commencée se termine même après la fermeture. */
  days: number[];
  /** Ouvert tous les jours (tests ; `DRAFT_OPEN=always`). */
  alwaysOpen: boolean;
  entryCoins: number;
  freePerWeekend: number;
  leaderChoices: number;
  /** Cartes proposées à chaque choix. */
  choices: number;
  maxWins: number;
  /** Un match nul compte comme une défaite. */
  maxLosses: number;
  /** Récompense de fin, selon le nombre de victoires (indice = victoires). */
  rewards: { coins: number; freeBoosters: number }[];
}

export const DEFAULT_DRAFT: DraftConfig = {
  days: [6, 0],
  alwaysOpen: false,
  entryCoins: 150,
  freePerWeekend: 1,
  leaderChoices: 3,
  choices: 3,
  maxWins: 5,
  maxLosses: 2,
  rewards: [
    { coins: 30, freeBoosters: 0 },
    { coins: 60, freeBoosters: 0 },
    { coins: 100, freeBoosters: 0 },
    { coins: 150, freeBoosters: 1 },
    { coins: 200, freeBoosters: 1 },
    { coins: 250, freeBoosters: 2 },
  ],
};

/**
 * Tournoi hebdomadaire (section 7) : inscriptions toute la semaine avec un de ses decks (copie figée), début le
 * `startDay` à `startHour` (UTC), élimination directe tirée au sort (seed cryptographique enregistrée).
 * Chaque tour dure `roundHours` : les deux joueurs jouent leur match en direct ; à l'échéance, un match non joué
 * est tranché par une simulation IA contre IA des deux decks. Récompenses selon le classement final.
 */
export interface TournamentConfig {
  /** Ordonnanceur (début des tournois, échéances des tours). Coupé en test (`TOURNAMENTS=off`). */
  enabled: boolean;
  startDay: number;
  startHour: number;
  roundHours: number;
  minPlayers: number;
  maxPlayers: number;
  /** Récompense selon le classement (`top` : 1 = champion, 2 = finaliste, 4 = demi-finaliste… ; 0 = participation). */
  rewards: { top: number; coins: number; freeBoosters: number }[];
  /** Titre du champion. */
  championTitle: { fr: string; en: string };
  /** Un match commencé en direct n'est pas tranché par simulation à l'échéance pendant ce délai. */
  liveGraceMinutes: number;
}

export const DEFAULT_TOURNAMENT: Omit<TournamentConfig, 'enabled'> = {
  startDay: 6,
  startHour: 12,
  roundHours: 6,
  minPlayers: 2,
  maxPlayers: 256,
  rewards: [
    { top: 1, coins: 500, freeBoosters: 3 },
    { top: 2, coins: 300, freeBoosters: 2 },
    { top: 4, coins: 200, freeBoosters: 1 },
    { top: 8, coins: 120, freeBoosters: 0 },
    { top: 0, coins: 50, freeBoosters: 0 },
  ],
  championTitle: { fr: 'Champion de la semaine', en: 'Weekly champion' },
  liveGraceMinutes: 30,
};

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
   * Anti-double compte : une empreinte déjà connue bloque l'inscription seulement depuis la même IP
   * (false, par défaut : deux téléphones du même modèle peuvent avoir la même empreinte ; ailleurs, SMS),
   * ou partout (true).
   */
  fingerprintStrict: boolean;
  guard: GuardConfig;
  /** E-mails des administrateurs (outil d'admin). */
  adminEmails: string[];
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
  missions: MissionsConfig;
  pass: PassConfig;
  ranked: RankedConfig;
  achievements: AchievementsConfig;
  trending: TrendingConfig;
  daily: DailyConfig;
  draft: DraftConfig;
  tournament: TournamentConfig;
  payments: PaymentsConfig;
  logLevel: string;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  welcomeBoosters: 6,
  boosterSize: 5,
  boosterPrice: 100,
  previewRefreshHours: 24,
  rarityWeights: { basique: 55, tendance: 27, viral: 12, iconique: 5, goat: 1 },
  keepCopies: 2,
  // Recycler un booster rapporte environ un quart de son prix : acheter pour recycler n'est jamais rentable.
  recycle: { basique: 1, tendance: 3, viral: 10, iconique: 30, goat: 100 },
  craft: { basique: 20, tendance: 50, viral: 150, iconique: 500, goat: 1500 },
  rewards: { win: 40, loss: 15, draw: 20, dailyCap: 400 },
  tradeUp: { count: 5, targetedCount: 8 },
  trades: { expiryHours: 72 },
};

/** Pays de lancement (section 4.5) : seuls leurs numéros reçoivent des SMS. */
const SMS_COUNTRIES = ['FR', 'BE', 'CH', 'CA', 'US', 'GB', 'BR', 'MX', 'ES', 'DE', 'IT', 'PL', 'JP', 'PH'];

/** Liste communautaire des domaines jetables, mise à jour en continu. */
const DISPOSABLE_LIST_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  if (production && !env.SIGNAL_SALT) throw new Error('SIGNAL_SALT est obligatoire en production.');
  if (production && env.TEST_FIXTURES === '1') throw new Error('TEST_FIXTURES est interdit en production.');
  if (production && !(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET)) throw new Error('TURNSTILE_SITE_KEY et TURNSTILE_SECRET sont obligatoires en production.');
  const smsMode = (env.SMS_MODE ?? 'risky') as SmsMode;
  if (!['off', 'risky', 'always'].includes(smsMode)) throw new Error(`SMS_MODE inconnu : ${smsMode}`);
  const paymentProvider = (env.PAYMENT_PROVIDER ?? (production ? 'none' : 'sandbox')) as PaymentsConfig['provider'];
  if (!['sandbox', 'none'].includes(paymentProvider)) throw new Error(`PAYMENT_PROVIDER inconnu : ${paymentProvider}`);
  if (production && paymentProvider === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox est interdit en production.');
  if (production && smsMode !== 'off' && !env.TWILIO_ACCOUNT_SID) throw new Error('TWILIO_* est obligatoire en production quand SMS_MODE est actif.');
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR ?? (production ? null : '.data/pglite'),
    sessionDays: int(env.SESSION_DAYS, 30),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === 'true' : false,
    signalSalt: env.SIGNAL_SALT ?? 'dev-only-salt',
    fingerprintStrict: env.FINGERPRINT_STRICT === 'true',
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    guard: {
      turnstile: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? { siteKey: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET } : null,
      signupPerIpPerMinute: int(env.SIGNUP_PER_IP_PER_MINUTE, 3),
      signupPerSubnetPerMinute: int(env.SIGNUP_PER_SUBNET_PER_MINUTE, 10),
      signupBlockMinutes: int(env.SIGNUP_BLOCK_MINUTES, 15),
      disposableListUrl: env.DISPOSABLE_LIST_URL ?? (production ? DISPOSABLE_LIST_URL : null),
      disposableExtra: env.DISPOSABLE_DOMAINS ? env.DISPOSABLE_DOMAINS.split(',') : [],
      smsMode,
      twilio:
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
          ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM }
          : null,
      smsCountries: env.SMS_COUNTRIES ? env.SMS_COUNTRIES.split(',') : SMS_COUNTRIES,
      smsCodeMinutes: 10,
      smsMaxAttempts: 5,
      smsPerPhonePerHour: int(env.SMS_PER_PHONE_PER_HOUR, 3),
      smsPerIpPerHour: int(env.SMS_PER_IP_PER_HOUR, 5),
      proxycheck: env.PROXYCHECK === 'off' ? null : env.PROXYCHECK_KEY || production || env.PROXYCHECK === 'on' ? { key: env.PROXYCHECK_KEY || null } : null,
    },
    ghostDelayMs: int(env.GHOST_DELAY_MS, 15_000),
    turnTimerMs: env.TURN_TIMER_MS ? int(env.TURN_TIMER_MS, 60_000) : null,
    reactionTimerMs: env.REACTION_TIMER_MS ? int(env.REACTION_TIMER_MS, 20_000) : null,
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    testFixtures: !production && env.TEST_FIXTURES === '1',
    economy: DEFAULT_ECONOMY,
    missions: DEFAULT_MISSIONS,
    pass: DEFAULT_PASS,
    ranked: DEFAULT_RANKED,
    achievements: DEFAULT_ACHIEVEMENTS,
    daily: DEFAULT_DAILY,
    tournament: { ...DEFAULT_TOURNAMENT, enabled: env.TOURNAMENTS !== 'off' && env.NODE_ENV !== 'test' },
    draft: { ...DEFAULT_DRAFT, alwaysOpen: env.DRAFT_OPEN === 'always' || env.NODE_ENV === 'test' },
    trending: { ...DEFAULT_TRENDING, enabled: env.TRENDING !== 'off' && env.NODE_ENV !== 'test' },
    payments: { provider: paymentProvider, sandboxSecret: env.SANDBOX_WEBHOOK_SECRET ?? 'dev-sandbox-secret' },
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
    guard: { ...loadConfig({ NODE_ENV: 'test' }).guard, signupPerIpPerMinute: 1000, signupPerSubnetPerMinute: 1000, smsPerIpPerHour: 1000 },
    logLevel: 'silent',
    ...overrides,
  };
}
