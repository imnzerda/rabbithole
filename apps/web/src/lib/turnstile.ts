/**
 * Cloudflare Turnstile : captcha invisible. Il ne s'affiche (case à cocher) que si Cloudflare
 * a un doute ; sinon le joueur ne voit rien. Le jeton est vérifié par le serveur, une seule fois.
 */

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface Captcha {
  /** Jeton courant ; attend que le défi invisible soit résolu. */
  token(): Promise<string>;
  /** Nouveau jeton (après une tentative : un jeton ne sert qu'une fois). */
  reset(): void;
  destroy(): void;
}

let script: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    el.async = true;
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    el.onerror = () => reject(new Error('turnstile'));
    document.head.append(el);
  });
  return script;
}

export async function mountTurnstile(el: HTMLElement, siteKey: string): Promise<Captcha> {
  const api = await load();
  let current: string | null = null;
  const waiters: ((token: string) => void)[] = [];
  const id = api.render(el, {
    sitekey: siteKey,
    action: 'signup',
    appearance: 'interaction-only',
    'refresh-expired': 'auto',
    callback: (token: string) => {
      current = token;
      for (const w of waiters.splice(0)) w(token);
    },
    'expired-callback': () => (current = null),
  });
  return {
    token: () =>
      current
        ? Promise.resolve(current)
        : new Promise((resolve, reject) => {
            waiters.push(resolve);
            setTimeout(() => reject(new Error('captcha_failed')), 30_000);
          }),
    reset: () => {
      current = null;
      api.reset(id);
    },
    destroy: () => api.remove(id),
  };
}
