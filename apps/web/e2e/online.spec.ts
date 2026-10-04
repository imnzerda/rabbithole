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

test('trade-up : rubrique dédiée, doublons choisis par le joueur, probabilités affichées', async ({ page }, info) => {
  await signup(page, `tu-${info.project.name}`, '/collection');
  await page.request.post('/api/test/set-card', { data: { cardId: 'proto_chevalier', quantity: 7 } });
  await page.request.post('/api/test/set-card', { data: { cardId: 'proto_garde', quantity: 4 } });
  // Depuis la Collection, le lien mène à la rubrique Trade-up.
  await page.reload();
  await page.getByTestId('to-tradeup').click();
  await expect(page).toHaveURL(/\/trade-up$/);
  await expect(page.getByTestId('tu-basique')).toContainText('7 doublons');
  await expect(page.getByTestId('tu-odds')).toContainText(/Tendance : \d+ cartes possibles, [\d.]+ % chacune/);

  // Le joueur choisit ce qu'il donne : 3 Chevaliers et 2 Gardes.
  await expect(page.getByTestId('tu-go')).toBeDisabled();
  const spares = page.getByTestId('tu-spares');
  const chevalier = spares.getByRole('button', { name: /Chevalier/ });
  for (let i = 0; i < 3; i++) await chevalier.click();
  await expect(page.getByTestId('tu-count')).toHaveText('3 / 5');
  const garde = spares.getByRole('button', { name: /Garde/ });
  await garde.click();
  await garde.click();
  await expect(page.getByTestId('tu-count')).toHaveText('5 / 5');

  // Le bouton d'échange est en haut et en bas de la sélection.
  await expect(page.getByTestId('tu-go')).toBeEnabled();
  await page.getByTestId('tu-go-top').click();
  const opened = page.getByTestId('opened');
  await expect(opened).toContainText('Ton trade-up');
  await expect(opened.getByRole('button')).toHaveCount(2); // 1 carte + Fermer
  await opened.getByRole('button', { name: 'Fermer' }).click();
  const owned = (await (await page.request.get('/api/collection')).json()).cards as { cardId: string; quantity: number }[];
  expect(owned.find((c) => c.cardId === 'proto_chevalier')?.quantity).toBe(4);
  expect(owned.find((c) => c.cardId === 'proto_garde')?.quantity).toBe(2);
  // Il reste 2 doublons : pas assez pour un nouveau trade-up.
  await expect(page.getByTestId('tu-basique')).toContainText('2 doublons');
  await expect(page.getByTestId('tu-go')).toBeDisabled();
  await expect(page.getByTestId('tu-go-top')).toHaveCount(0);
});

test('amis et échange : ajout par code ami, plusieurs cartes de raretés différentes, acceptation', async ({ page, browser, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL }, info) => {
  // Bob, sur un autre appareil.
  const other = await browser.newContext({ viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL, locale: 'fr-FR' });
  await asDevice(other, device + 1);
  const bob = await other.newPage();
  await signup(bob, `bob-${info.project.name}`, '/friends');
  const code = (await bob.getByTestId('friend-code').textContent())!.trim();

  // Alice l'ajoute par son code ; Bob accepte.
  await signup(page, `alice-${info.project.name}`, '/friends');
  await page.getByTestId('friend-target').fill(code);
  await page.getByTestId('add-friend').click();
  await expect(page.getByTestId('message')).toContainText('Demande envoyée');
  await bob.reload();
  await bob.getByTestId('accept-friend').click();
  await expect(bob.getByTestId('friend')).toHaveCount(1);

  // Alice donne 2 basiques et une GOAT contre une basique de Bob : raretés et nombres libres.
  await page.request.post('/api/test/set-card', { data: { cardId: 'proto_chevalier', quantity: 2 } });
  await page.request.post('/api/test/set-card', { data: { cardId: 'proto_empereur', quantity: 1 } });
  await bob.request.post('/api/test/set-card', { data: { cardId: 'proto_garde', quantity: 1 } });

  // Depuis la page Amis, « Proposer un échange » ouvre la proposition dans la rubrique Échanges.
  await page.reload();
  await page.getByTestId('propose-trade').click();
  await expect(page).toHaveURL(/\/trades\?with=/);
  const sheet = page.getByTestId('proposal');
  await sheet.getByTestId('theirs').getByRole('button', { name: /Garde/ }).click();
  const chevalier = sheet.getByTestId('mine').getByRole('button', { name: /Chevalier/ });
  await chevalier.click();
  await chevalier.click();
  await sheet.getByTestId('mine').getByRole('button', { name: /Empereur/ }).click();
  await expect(sheet.getByTestId('trade-summary')).toHaveText('Tu donnes 3 carte(s), tu reçois 1 carte(s).');
  await sheet.getByTestId('send-trade').click();
  await expect(page.getByTestId('message')).toHaveText('Proposition envoyée.');
  await expect(page.getByTestId('trade-outgoing')).toHaveCount(1);

  // Bob voit la proposition signalée depuis ses amis, puis dans ses échanges.
  await bob.reload();
  await expect(bob.getByTestId('to-trades')).toContainText('1');
  await bob.getByTestId('to-trades').click();
  await expect(bob.getByTestId('trade-incoming')).toHaveCount(1);
  await bob.getByTestId('trade-accept').click();
  await expect(bob.getByTestId('message')).toHaveText('Échange effectué !');
  const owned = (await (await bob.request.get('/api/collection')).json()).cards as { cardId: string; quantity: number }[];
  expect(owned.sort((x, y) => x.cardId.localeCompare(y.cardId))).toEqual([
    { cardId: 'proto_chevalier', quantity: 2 },
    { cardId: 'proto_empereur', quantity: 1 },
  ]);
  await other.close();
});

test('boutique : pack de gemmes payé en sandbox, crédité par webhook, historique ; paiement annulé', async ({ page }, info) => {
  await signup(page, `shop-${info.project.name}`, '/shop');
  await expect(page.getByTestId('gems')).toHaveText('💎 0');

  await page.getByTestId('pack-gems_80').getByRole('button').click();
  await expect(page).toHaveURL(/\/shop\/sandbox\?session=sbx_/);
  await page.getByTestId('sandbox-pay').click();
  await expect(page).toHaveURL(/\/shop\?status=success$/);
  await expect(page.getByTestId('gems')).toHaveText('💎 80');
  await expect(page.getByTestId('purchase')).toHaveCount(1);
  await expect(page.getByTestId('purchase')).toContainText('Payé');
  await expect(page.getByTestId('message')).toHaveText('Merci ! Tes gemmes ont été ajoutées.');

  // Paiement abandonné : rien n'est crédité ni dû.
  await page.getByTestId('pack-gems_170').getByRole('button').click();
  await page.getByTestId('sandbox-cancel').click();
  await expect(page.getByTestId('message')).toHaveText("Paiement annulé : rien n'a été débité.");
  await expect(page.getByTestId('gems')).toHaveText('💎 80');
  await expect(page.getByTestId('purchase')).toHaveCount(1);
});

test('missions : 3 du jour et 3 de la semaine, réclamation une fois remplie', async ({ page }, info) => {
  await signup(page, `missions-${info.project.name}`, '/missions');
  await expect(page.getByTestId('mission')).toHaveCount(6);
  await expect(page.getByText(/Renouvellement dans/).first()).toBeVisible();
  for (const button of await page.getByTestId('claim').all()) await expect(button).toBeDisabled();

  // Les missions sont tirées au hasard : si « ouvrir un booster » est sortie, on la remplit et on la réclame.
  const missions = (await (await page.request.get('/api/missions')).json()) as { daily: { missions: { kind: string }[] } };
  if (missions.daily.missions.some((m) => m.kind === 'open_booster')) {
    await page.request.post('/api/boosters/base/open-free');
    await page.reload();
    const row = page.getByTestId('mission').filter({ hasText: 'Ouvre 1 booster' });
    await row.getByTestId('claim').click();
    await expect(page.getByTestId('message')).toHaveText('+30 🪙 !');
    await expect(row).toContainText('Réclamée');
  }
});

test('pass : achat direct du premium, récompenses réclamées, booster à aperçu offert ouvert dans la Collection', async ({ page }, info) => {
  await signup(page, `pass-${info.project.name}`, '/pass');
  await expect(page.getByTestId('pass-level')).toContainText('Niveau 0 / 30 · Gratuit');
  await expect(page.getByTestId('tier')).toHaveCount(30);

  // Achat direct (pas en gemmes) : page de paiement du prestataire, retour sur le pass.
  await page.getByTestId('buy-pass_premium').click();
  await expect(page).toHaveURL(/\/shop\/sandbox\?session=sbx_/);
  await page.getByTestId('sandbox-pay').click();
  await expect(page).toHaveURL(/\/pass\?status=success$/);
  await expect(page.getByTestId('message')).toHaveText('Merci ! Ta piste est débloquée.');
  await expect(page.getByTestId('pass-level')).toContainText('Premium');
  await expect(page.getByTestId('buy-pass_upgrade')).toBeVisible();

  // Trois niveaux de points (route de test), puis les récompenses premium des niveaux 1 et 3.
  await page.request.post('/api/test/pass-xp', { data: { xp: 3000 } });
  await page.reload();
  await page.getByTestId('reward-premium-1').getByRole('button').click();
  await expect(page.getByTestId('message')).toContainText('Titre');
  await page.getByTestId('reward-premium-3').getByRole('button').click();
  await expect(page.getByTestId('message')).toContainText('Booster à aperçu');

  // Le booster offert ouvre exactement l'aperçu affiché dans la Collection.
  await page.goto('/collection');
  await expect(page.getByTestId('preview-boosters')).toHaveText('📦 1');
  const preview = await page.getByTestId('preview').getByRole('button').allTextContents();
  await page.getByTestId('redeem').click();
  const opened = page.getByTestId('opened');
  await expect(opened.getByRole('button')).toHaveCount(6);
  expect((await opened.getByRole('button').allTextContents()).slice(0, 5).map((s) => s.replace('Nouveau', ''))).toEqual(preview.map((s) => s.replace('Nouveau', '')));
  await opened.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByTestId('preview-boosters')).toHaveCount(0);
  await expect(page.getByTestId('wallet')).toContainText('🪙 0');
});

test('classé : partie classée (fantôme après l’attente), points en fin de partie, page Classement', async ({ page }, info) => {
  await signup(page, `ranked-${info.project.name}`, '/online');
  await page.request.post('/api/test/grant-kit');
  await page.reload();
  await expect(page.getByTestId('my-rank-badge')).toHaveText('Lurker · 0 points');

  // File classée : un fantôme après l'attente, ou l'autre navigateur de test s'il est en file au même moment.
  // On abandonne dès que possible ; si l'adversaire abandonne avant, la partie est gagnée.
  await page.getByTestId('mode-ranked').click();
  const fold = page.getByTestId('fold');
  for (let i = 0; i < 50; i++) {
    const v = await waitDecision(page);
    if (v.phase === 'ended') break;
    if (await fold.isEnabled()) {
      page.once('dialog', (d) => void d.accept());
      await fold.click();
      break;
    }
    await autoStep(page);
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  const won = (await page.getByTestId('end-screen').textContent())!.includes('Victoire');
  // Défaite au rang Lurker : jamais sous 0 ; victoire : +25.
  await expect(page.getByTestId('ranked-points')).toContainText(won ? '+25 points de classement' : '±0 points de classement');
  await expect(page.getByTestId('ranked-rank')).toHaveText(won ? 'Lurker · 25 points' : 'Lurker · 0 points');

  await page.goto('/ranked');
  await expect(page.getByTestId('my-rank')).toContainText('Lurker');
  await expect(page.getByTestId('my-rank')).toContainText(won ? '1 V · 0 D · 0 N' : '0 V · 1 D · 0 N');
  await expect(page.getByTestId('leaderboard').locator('li.you')).toHaveCount(1);
  await page.getByTestId('tab-country').click();
  await expect(page.getByTestId('leaderboard').locator('li.you')).toHaveCount(1);
});

test('succès : collection, progression de collection, Spécialiste et titre affiché', async ({ page }, info) => {
  await signup(page, `ach-${info.project.name}`, '/achievements');
  await page.request.post('/api/test/grant-kit');
  await page.reload();

  await page.getByTestId('claim-cards_25').click();
  await expect(page.getByTestId('message')).toHaveText('+50 🪙 !');
  await page.getByTestId('claim-collection').click();
  await expect(page.getByTestId('message')).toContainText('niveau(x) réclamé(s)');
  await expect(page.getByTestId('claim-collection')).toBeDisabled();

  await page.getByTestId('claim-specialist_exploration').click();
  await expect(page.getByTestId('message')).toContainText('et le titre « Spécialiste');
  await page.getByTestId('titles').getByRole('button', { name: /Spécialiste/ }).click();
  await expect(page.getByTestId('message')).toContainText('Titre affiché : « Spécialiste');
  const cosmetics = (await (await page.request.get('/api/cosmetics')).json()) as { activeTitle: string };
  expect(cosmetics.activeTitle).toBe('achievement_specialist_exploration');
});

test('Tendance du jour : annonce sur l’accueil, page Tendances', async ({ page }, info) => {
  await signup(page, `trend-${info.project.name}`, '/');
  const cards = (await (await page.request.get('/api/catalog')).json()).cards as { id: string; type: string }[];
  const ids = cards.filter((c) => c.type !== 'leader').slice(0, 3).map((c) => c.id);
  await page.request.post('/api/test/trending', { data: { cardIds: ids } });
  await page.reload();
  await expect(page.getByTestId('trending-banner')).toContainText('3 cartes ont +1 puissance');
  await page.getByTestId('trending-banner').click();
  await expect(page).toHaveURL(/\/trending$/);
  await expect(page.getByTestId('trending').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('trending')).toContainText('×10');
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
  // Plage mobile attribuée (06 12…) : le serveur refuse les numéros hors plan de numérotation.
  const digits = `12${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
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

test('défi du jour : deck imposé sans collection, une tentative, score à partager, classement du jour', async ({ page }, info) => {
  await signup(page, `daily-${info.project.name}`, '/');
  await page.getByTestId('nav-daily').click();
  await page.getByTestId('daily-play').click();

  // Le défi démarre tout de suite contre l'IA, avec le deck du jour (le compte n'a aucune carte).
  // On abandonne dès l'apparition du plateau, sans attendre la fin des animations : le bouton est actif en permanence.
  const fold = page.getByTestId('fold');
  await expect(fold).toBeEnabled();
  await expect(fold).toHaveText('Abandonner');
  page.once('dialog', (d) => void d.accept());
  await fold.click();
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('replay')).toHaveCount(0);
  await page.getByTestId('end-screen').getByRole('button', { name: 'Menu' }).click();

  await expect(page).toHaveURL(/\/daily$/);
  await expect(page.getByTestId('daily-result')).toContainText('Défaite');
  await expect(page.getByTestId('daily-share')).toContainText('RABBIT HOLE · Défi du');
  await expect(page.getByTestId('daily-share')).toContainText('#RabbitHole');
  await expect(page.getByTestId('daily-play')).toHaveCount(0);
  await expect(page.getByTestId('daily-board').locator('li.you')).toHaveCount(1);
});

test('draft du week-end : entrée gratuite, Leader puis cartes, partie de draft, bilan', async ({ page }, info) => {
  await signup(page, `draft-${info.project.name}`, '/');
  await page.getByTestId('nav-draft').click();
  await page.getByTestId('draft-free').click();

  // Leader parmi les propositions, puis une carte par proposition jusqu'au deck complet (20).
  const take = page.getByTestId('draft-offer').getByTestId('draft-take');
  await expect(page.getByRole('heading', { name: 'Choisis ton Leader' })).toBeVisible();
  await take.first().click();
  for (let n = 1; n <= 20; n++) {
    await expect(page.getByRole('heading', { name: `Choix ${n} / 20` })).toBeVisible();
    await take.first().click();
  }
  await expect(page.getByRole('heading', { name: 'Ton deck (20 / 20)' })).toBeVisible();
  await expect(page.getByTestId('draft-free')).toHaveCount(0);

  // Partie de draft : un fantôme après l'attente, ou l'autre navigateur de test s'il est en file draft au même moment.
  // On abandonne tout de suite ; si l'adversaire abandonne avant, la partie est gagnée.
  await page.getByTestId('draft-play').click();
  const fold = page.getByTestId('fold');
  await expect(fold).toBeEnabled({ timeout: 30_000 });
  page.once('dialog', (d) => void d.accept());
  await fold.click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId('end-screen')).toBeVisible();
  const won = (await page.getByTestId('end-screen').textContent())!.includes('Victoire');
  await page.getByTestId('end-screen').getByRole('button', { name: 'Menu' }).click();
  await expect(page).toHaveURL(/\/draft$/);
  await expect(page.getByRole('heading', { name: won ? '1 victoire(s) · 0 défaite(s)' : '0 victoire(s) · 1 défaite(s)' })).toBeVisible();

  // Arrêt du draft : récompense des victoires obtenues (barème : 30 pour 0 victoire, 60 pour 1).
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('draft-retire').click();
  await expect(page.getByTestId('message')).toHaveText(`Draft terminé : +${won ? 60 : 30} 🪙.`);
  await expect(page.getByTestId('draft-result')).toContainText(won ? '1 victoire(s), 0 défaite(s)' : '0 victoire(s), 1 défaite(s)');
  await expect(page.getByTestId('draft-free')).toHaveCount(0);
  await expect(page.getByTestId('draft-coins')).toBeVisible();
});
