import { isIPv4, isIPv6 } from 'node:net';
import { disposableEmailBlocklistSet } from 'disposable-email-domains-js';
import type { GuardConfig } from '../config.js';

/**
 * Services externes de protection de l'inscription, derrière des interfaces
 * pour pouvoir les remplacer dans les tests (aucun appel réseau en test).
 */

// ---------------------------------------------------------------------------
// Captcha invisible : Cloudflare Turnstile
// ---------------------------------------------------------------------------

export interface CaptchaVerifier {
  readonly enabled: boolean;
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

/** Vérifie le jeton Turnstile auprès de Cloudflare. Un jeton ne sert qu'une fois. */
export class TurnstileVerifier implements CaptchaVerifier {
  readonly enabled = true;
  constructor(private readonly secret: string) {}

  async verify(token: string | undefined, ip: string): Promise<boolean> {
    if (!token) return false;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: this.secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const json = (await res.json()) as { success?: boolean };
      return json.success === true;
    } catch {
      return false; // Cloudflare injoignable : on refuse plutôt que de laisser passer les robots.
    }
  }
}

/** Captcha désactivé (développement, tests) : tout passe. */
export const noCaptcha: CaptchaVerifier = { enabled: false, verify: async () => true };

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** Envoi par l'API Twilio (sans SDK). */
export class TwilioSms implements SmsSender {
  constructor(private readonly cfg: { accountSid: string; authToken: string; from: string }) {}

  async send(to: string, text: string): Promise<void> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}` },
      body: new URLSearchParams({ To: to, From: this.cfg.from, Body: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}`);
  }
}

/** Développement et tests : le SMS est écrit dans le journal et gardé en mémoire (route de test). */
export class ConsoleSms implements SmsSender {
  readonly last = new Map<string, string>();
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}

  async send(to: string, text: string): Promise<void> {
    this.last.set(to, text);
    this.log(`[SMS → ${to}] ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Réputation d'IP : VPN, proxys, hébergeurs
// ---------------------------------------------------------------------------

export interface IpVerdict {
  /** VPN, proxy ou hébergeur (centre de données) : l'IP ne dit rien de l'appareil. */
  risky: boolean;
  type?: string;
}

export interface IpReputation {
  check(ip: string): Promise<IpVerdict>;
}

export const noIpReputation: IpReputation = { check: async () => ({ risky: false }) };

/** proxycheck.io, avec cache d'une heure (l'IP n'est gardée qu'en mémoire). */
export class ProxyCheck implements IpReputation {
  private readonly cache = new Map<string, { verdict: IpVerdict; until: number }>();
  constructor(private readonly key: string | null) {}

  async check(ip: string): Promise<IpVerdict> {
    if (isPrivateIp(ip)) return { risky: false };
    const hit = this.cache.get(ip);
    if (hit && hit.until > Date.now()) return hit.verdict;
    let verdict: IpVerdict = { risky: false };
    try {
      const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1${this.key ? `&key=${this.key}` : ''}`;
      const json = (await (await fetch(url, { signal: AbortSignal.timeout(3000) })).json()) as Record<string, { proxy?: string; type?: string }>;
      const entry = json[ip];
      if (entry) verdict = { risky: entry.proxy === 'yes', type: entry.type };
    } catch {
      // Service injoignable : on ne bloque pas les vrais joueurs pour autant.
    }
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(ip, { verdict, until: Date.now() + 3_600_000 });
    return verdict;
  }
}

function isPrivateIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  if (isIPv4(v4)) return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(v4);
  return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

// ---------------------------------------------------------------------------
// Limitation du débit avec blocage temporaire (mémoire du serveur ; Redis en phase 8)
// ---------------------------------------------------------------------------

export class Limiter {
  private readonly hits = new Map<string, number[]>();
  private readonly blocked = new Map<string, number>();

  /**
   * Compte une tentative. Renvoie le nombre de secondes d'attente si la clé est bloquée
   * (limite dépassée sur la fenêtre → blocage pendant `blockMs`), sinon 0.
   */
  hit(key: string, limit: number, windowMs: number, blockMs: number, now = Date.now()): number {
    const until = this.blocked.get(key);
    if (until !== undefined) {
      if (until > now) return Math.ceil((until - now) / 1000);
      this.blocked.delete(key);
    }
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (recent.length > limit) {
      this.blocked.set(key, now + blockMs);
      this.hits.delete(key);
      return Math.ceil(blockMs / 1000);
    }
    if (this.hits.size > 50_000) this.hits.clear();
    return 0;
  }
}

/** Sous-réseau d'une IP : /24 en IPv4, /64 en IPv6. */
export function subnetOf(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, '');
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.padStart(4, '0')).join(':')}::/64`;
}

// ---------------------------------------------------------------------------
// E-mails : jetables et alias
// ---------------------------------------------------------------------------

/** Liste des domaines jetables : liste embarquée (paquet npm) + liste en ligne rafraîchie chaque jour + ajouts manuels. */
export class DisposableDomains {
  private domains: Set<string>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: Pick<GuardConfig, 'disposableListUrl' | 'disposableExtra'>) {
    this.domains = new Set([...disposableEmailBlocklistSet(), ...cfg.disposableExtra.map((d) => d.trim().toLowerCase())]);
  }

  /** Vrai si le domaine, ou l'un de ses domaines parents, est jetable. */
  has(domain: string): boolean {
    const parts = domain.trim().toLowerCase().split('.');
    for (let i = 0; i < parts.length - 1; i++) if (this.domains.has(parts.slice(i).join('.'))) return true;
    return false;
  }

  isDisposableEmail(email: string): boolean {
    return this.has(email.split('@')[1] ?? '');
  }

  get size(): number {
    return this.domains.size;
  }

  /** Télécharge la liste en ligne maintenant, puis toutes les 24 h. */
  start(onError: (err: unknown) => void): void {
    if (!this.cfg.disposableListUrl) return;
    const refresh = async () => {
      try {
        const res = await fetch(this.cfg.disposableListUrl!, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const line of (await res.text()).split('\n')) {
          const d = line.trim().toLowerCase();
          if (d && !d.startsWith('#')) this.domains.add(d);
        }
      } catch (err) {
        onError(err);
      }
    };
    void refresh();
    this.timer = setInterval(refresh, 24 * 3_600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/**
 * E-mail canonique, pour l'unicité des comptes : casse ignorée, alias « +… » retirés
 * (tous les domaines), points ignorés chez Gmail. `Jean.Dupont+2@gmail.com` → `jeandupont@gmail.com`.
 */
export function canonicalEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  let user = local.split('+')[0] ?? '';
  let host = domain;
  if (GMAIL.has(host)) {
    user = user.replaceAll('.', '');
    host = 'gmail.com';
  }
  return `${user}@${host}`;
}

// ---------------------------------------------------------------------------
// Ensemble des services
// ---------------------------------------------------------------------------

export interface Guard {
  captcha: CaptchaVerifier;
  sms: SmsSender;
  ipReputation: IpReputation;
  disposable: DisposableDomains;
  limiter: Limiter;
}

export function createGuard(cfg: GuardConfig, log: (msg: string) => void): Guard {
  return {
    captcha: cfg.turnstile ? new TurnstileVerifier(cfg.turnstile.secret) : noCaptcha,
    sms: cfg.twilio ? new TwilioSms(cfg.twilio) : new ConsoleSms(log),
    ipReputation: cfg.proxycheck ? new ProxyCheck(cfg.proxycheck.key) : noIpReputation,
    disposable: new DisposableDomains(cfg),
    limiter: new Limiter(),
  };
}
