import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { PlayerView } from '@rabbithole/engine';

type Hook = { view(): PlayerView | null; busy(): boolean; act(a: unknown): void };

async function waitDecision(page: Page): Promise<PlayerView> {
  await page.waitForFunction(
    () => {
      const rh = (window as unknown as { __rabbithole?: Hook }).__rabbithole;
      const v = rh?.view();
      return !!v && !rh!.busy() && (!!v.legal || v.phase === 'ended');
    },
    null,
    { timeout: 60_000 },
  );
  return (await page.evaluate(() => (window as unknown as { __rabbithole: Hook }).__rabbithole.view()))!;
}

/** Décision simple : poser, attaquer le Leader, sinon finir le tour ; ne jamais défendre. */
async function autoStep(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rh = (window as unknown as { __rabbithole: Hook }).__rabbithole;
    const legal = rh.view()!.legal;
    if (!legal) return;
    if (legal.kind === 'mulligan') return rh.act({ type: 'mulligan', redraw: false });
    if (legal.kind === 'block') return rh.act({ type: 'block', blocker: null });
    if (legal.kind === 'counter') return rh.act({ type: 'counter', uids: [] });
    if (legal.kind === 'trigger') return rh.act({ type: 'trigger', activate: false });
    const play = legal.playable[0];
    if (play) return rh.act({ type: 'play', uid: play });
    const a = legal.attackers[0];
    if (a) return rh.act({ type: 'attack', attacker: a.uid, target: a.targets[0] });
    return rh.act({ type: 'end_turn' });
  });
}

/**
 * Les tests tournent en parallèle sur la même machine, donc avec la même empreinte numérique :
 * chaque test simule un appareil distinct en changeant deux de ses composantes (cœurs et mémoire).
 */
let device = 0;
async function asDevice(context: BrowserContext, id: number): Promise<void> {
  await context.addInitScript((n) => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => n });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => n });
  }, id);
}
test.beforeEach(async ({ context }) => {
  device = 1000 + Math.floor(Math.random() * 1e9);
  await asDevice(context, device);
});

/** Inscription par le formulaire. */
async function signup(page: Page, label: string, next = '/'): Promise<void> {
  await page.goto(`/signup?next=${encodeURIComponent(next)}`);
  await page.getByTestId('name').fill(`Testeur ${label}`.slice(0, 24));
  await page.getByTestId('email').fill(`e2e-${label}-${Date.now()}@example.com`);
  await page.getByTestId('password').fill('motdepasse1');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(new RegExp(`${next.replace('/', '\\/')}$`));
}

test('nouveau compte : aucune carte, Leader de départ, booster gratuit, achat bloqué sans pièces', async ({ page }, info) => {
  await signup(page, `eco-${info.project.name}`, '/collection');
  await expect(page.getByTestId('wallet')).toContainText('🪙 0');
  await expect(page.getByTestId('wallet')).toContainText('🎁 6');

  await page.getByTestId('choose-proto_l_influenceuse').click();
  await expect(page.getByTestId('starter')).toBeHidden();

  await page.getByTestId('open-free').click();
  const opened = page.getByTestId('opened');
  await expect(opened).toBeVisible();
  await expect(opened.getByRole('button')).toHaveCount(6); // 5 cartes + Fermer
  await opened.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByTestId('wallet')).toContainText('🎁 5');

  // Aperçu exact affiché, achat impossible sans pièces, probabilités visibles.
  await expect(page.getByTestId('preview').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('buy')).toBeDisabled();
  await page.getByText('Probabilités par carte').click();
  await expect(page.getByText(/GOAT\s+[\d.]+ %/)).toBeVisible();

  // Pas encore de deck : le salon renvoie vers les boosters et l'éditeur.
  await page.goto('/online');
  await expect(page.getByTestId('no-deck')).toBeVisible();
});

test('éditeur de decks : Leader, complétion automatique, enregistrement', async ({ page }, info) => {
  await signup(page, `deck-${info.project.name}`, '/decks');
  await page.request.post('/api/test/grant-kit');
  await page.reload();
  await page.getByTestId('new-deck').click();
  await page.getByTestId('deck-name').fill('Mon deck E2E');
  await page.getByTestId('auto-fill').click();
  await expect(page.getByTestId('deck-count')).toHaveText('20/20 cartes');
  await page.getByTestId('save-deck').click();
  await expect(page.getByRole('status')).toHaveText('Deck enregistré !');
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByText('Mon deck E2E')).toBeVisible();
});

test('en ligne : partie contre un fantôme jusqu’au bout, pièces gagnées, historique et replay', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signup(page, `online-${info.project.name}`, '/online');
  await page.request.post('/api/test/grant-kit');
  await page.reload();

  await page.getByTestId('mode-ghost').click();
  for (let i = 0; i < 500; i++) {
    const v = await waitDecision(page);
    if (v.phase === 'ended') break;
    await autoStep(page);
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('reward')).toHaveText(/^\+\d+ 🪙$/);
  await page.getByTestId('replay').click(); // « Rejouer » ramène au salon
  await expect(page.getByTestId('mode-ghost')).toBeVisible();

  await page.goto('/replays');
  await expect(page.getByTestId('watch')).toHaveCount(1);
  await page.getByTestId('watch').click();
  await expect(page).toHaveURL(/\/replays\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Replay · [1-9]\d*\//)).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('inscription sans condition d’âge ; un seul compte par appareil, même après effacement des cookies', async ({ page, browser, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL }, info) => {
  await signup(page, `device1-${info.project.name}`);

  // Même navigateur, après déconnexion : le cookie d'appareil suffit.
  await page.request.post('/api/auth/logout');
  const second = async (p: Page, label: string) => {
    await p.goto('/signup');
    await p.getByTestId('name').fill('Deuxième');
    await p.getByTestId('email').fill(`${label}-${info.project.name}-${Date.now()}@example.com`);
    await p.getByTestId('password').fill('motdepasse1');
    await p.getByTestId('submit').click();
    await expect(p.getByRole('alert')).toContainText('Un compte existe déjà sur cet appareil');
  };
  await second(page, 'device2');

  // Nouveau navigateur vierge (cookies effacés, navigation privée) sur le même appareil : l'empreinte suffit.
  const fresh = await browser.newContext({ viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL, locale: 'fr-FR' });
  await asDevice(fresh, device);
  await second(await fresh.newPage(), 'device3');
  await fresh.close();
});

test('VPN détecté : vérification du numéro par SMS, puis compte créé', async ({ page, context }, info) => {
  // Le serveur de test traite cet en-tête comme une IP de VPN (jamais en production).
  await context.setExtraHTTPHeaders({ 'x-test-risk': 'vpn' });
  await page.goto('/signup?next=/collection');
  await page.getByTestId('name').fill('Voyageur');
  await page.getByTestId('email').fill(`vpn-${info.project.name}-${Date.now()}@example.com`);
  await page.getByTestId('password').fill('motdepasse1');
  await page.getByTestId('submit').click();

  await expect(page.getByRole('heading', { name: 'Vérifie ton numéro' })).toBeVisible();
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  await page.getByTestId('phone').fill(`06${digits}`);
  await page.getByTestId('send-code').click();
  await expect(page.getByRole('status')).toContainText('Code envoyé au +336');

  const sms = await (await page.request.get(`/api/test/sms?phone=${encodeURIComponent(`+336${digits}`)}`)).json();
  const code = /\d{6}/.exec(sms.text as string)![0];
  await page.getByTestId('code').fill(code === '000000' ? '111111' : '000000');
  await page.getByTestId('verify-code').click();
  await expect(page.getByRole('alert')).toContainText('Code incorrect. Encore 4 essai(s).');
  await page.getByTestId('code').fill(code);
  await page.getByTestId('verify-code').click();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.getByTestId('wallet')).toContainText('🎁 6');
});
