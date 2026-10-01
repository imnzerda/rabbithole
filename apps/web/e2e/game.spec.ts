import { expect, test, type Page } from '@playwright/test';
import type { GameAction, PlayerView } from '@rabbithole/engine';

declare global {
  interface Window {
    __rabbithole: {
      view: () => PlayerView | null;
      busy: () => boolean;
      act: (action: GameAction) => Promise<void>;
      handCard: (index: number) => { x: number; y: number } | null;
    };
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Attend que ce soit au joueur de décider (ou la fin de partie), animations terminées. */
async function waitDecision(page: Page): Promise<PlayerView> {
  await page.waitForFunction(
    () => {
      const rh = window.__rabbithole;
      const v = rh?.view();
      return !!v && !rh.busy() && (!!v.legal || v.phase === 'ended');
    },
    null,
    { timeout: 60_000 },
  );
  return (await page.evaluate(() => window.__rabbithole.view()))!;
}

/** Décision simple et rapide : poser, attaquer le Leader, sinon finir le tour ; ne jamais défendre. */
async function autoStep(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rh = window.__rabbithole;
    const legal = rh.view()?.legal;
    if (!legal) return;
    if (legal.kind === 'mulligan') return rh.act({ type: 'mulligan', redraw: false });
    if (legal.kind === 'block') return rh.act({ type: 'block', blocker: null });
    if (legal.kind === 'counter') return rh.act({ type: 'counter', uids: [] });
    if (legal.kind === 'trigger') return rh.act({ type: 'trigger', activate: false });
    const play = legal.playable[0];
    if (play) return rh.act({ type: 'play', uid: play });
    const a = legal.attackers[0];
    if (a) return rh.act({ type: 'attack', attacker: a.uid, target: a.targets[0]! });
    return rh.act({ type: 'end_turn' });
  });
}

/** Avance jusqu'à la phase principale du joueur. */
async function toMyMain(page: Page): Promise<PlayerView> {
  for (let i = 0; i < 50; i++) {
    const v = await waitDecision(page);
    if (v.legal?.kind === 'main') return v;
    await autoStep(page);
  }
  throw new Error('phase principale jamais atteinte');
}

test('menu : 5 decks avec leur Leader, lancement d’une partie', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RABBIT HOLE' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(5);
  await expect(page.getByTestId('deck-coups_tordus')).toContainText('La Baronne du Crime');
  await page.getByTestId('deck-coups_tordus').click();
  await page.getByTestId('play').click();
  await expect(page).toHaveURL(/\/play\?deck=coups_tordus/);
  await waitDecision(page);
  expect(errors).toEqual([]);
});

test('mulligan : panneau de main de départ, puis la partie commence', async ({ page }) => {
  await page.goto('/play?deck=internet_party&timer=0');
  const v = await waitDecision(page);
  if (v.legal?.kind === 'mulligan') {
    await expect(page.getByTestId('decision-mulligan')).toBeVisible();
    await page.getByTestId('keep').click();
  }
  const after = await waitDecision(page);
  expect(after.phase).not.toBe('mulligan');
  expect(after.me.life).toBe(4);
});

test('partie complète jusqu’à l’écran de fin, puis Rejouer', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/play?deck=ordre_et_pouvoir&timer=0');
  for (let i = 0; i < 400; i++) {
    const v = await waitDecision(page);
    if (v.phase === 'ended') break;
    await autoStep(page);
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.getByTestId('replay').click();
  await expect(page.getByTestId('end-screen')).toBeHidden();
  const fresh = await waitDecision(page);
  expect(fresh.turn).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('glisser une carte de la main vers le plateau la joue', async ({ page }) => {
  await page.goto('/play?deck=tapis_rouge&timer=0');
  let v = await toMyMain(page);
  // Joue des tours jusqu'à avoir une carte jouable en main.
  for (let i = 0; i < 6 && v.legal!.playable.length === 0; i++) {
    await page.evaluate(() => window.__rabbithole.act({ type: 'end_turn' }));
    v = await toMyMain(page);
  }
  const uid = v.legal!.playable[0];
  test.skip(!uid, 'Aucune carte jouable');
  const index = v.me.hand.findIndex((c) => c.uid === uid);
  await page.waitForTimeout(600); // fin de l'arrivée animée de la main
  const pos = await page.evaluate((i) => window.__rabbithole.handCard(i), index);
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.mouse.down();
  await page.mouse.move(pos!.x, pos!.y - 80, { steps: 4 });
  await page.mouse.move(pos!.x, pos!.y - 320, { steps: 8 });
  await page.mouse.up();
  const after = await waitDecision(page);
  expect(after.me.hand.some((c) => c.uid === uid)).toBe(false);
});

test('appui long : fiche détaillée ; aide des règles', async ({ page }) => {
  await page.goto('/play?deck=longue_route&timer=0');
  await toMyMain(page);
  await page.waitForTimeout(800);
  const pos = await page.evaluate(() => window.__rabbithole.handCard(0));
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Rareté');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Règles' }).click();
  await expect(page.getByRole('dialog')).toContainText('Les règles en 1 minute');
  await expect(page.getByRole('dialog')).toContainText('Mets KO le Leader adverse');
});
