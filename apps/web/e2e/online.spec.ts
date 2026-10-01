import { expect, test, type Page } from '@playwright/test';
import type { PlayerView } from '@rabbithole/engine';

async function waitDecision(page: Page): Promise<PlayerView> {
  await page.waitForFunction(
    () => {
      const rh = (window as unknown as { __rabbithole?: { view(): PlayerView | null; busy(): boolean } }).__rabbithole;
      const v = rh?.view();
      return !!v && !rh!.busy() && (!!v.legal || v.phase === 'ended');
    },
    null,
    { timeout: 60_000 },
  );
  return (await page.evaluate(() => (window as unknown as { __rabbithole: { view(): PlayerView } }).__rabbithole.view()))!;
}

/** Décision simple : poser, attaquer le Leader, sinon finir le tour ; ne jamais défendre. */
async function autoStep(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rh = (window as unknown as { __rabbithole: { view(): PlayerView; act(a: unknown): void } }).__rabbithole;
    const legal = rh.view().legal;
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

test('en ligne : inscription, partie contre un fantôme jusqu’au bout, historique et replay', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const email = `e2e-${info.project.name}-${Date.now()}@example.com`;

  // Inscription (21+) depuis le salon.
  await page.goto('/online');
  await page.getByRole('link', { name: 'Créer un compte' }).click();
  await page.getByTestId('name').fill('Testeur E2E');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('motdepasse1');
  await page.getByTestId('birth').fill('1994-04-12');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(/\/online$/);

  // Partie contre un fantôme, jouée jusqu'au bout par le serveur qui fait foi.
  await page.getByTestId('mode-ghost').click();
  for (let i = 0; i < 500; i++) {
    const v = await waitDecision(page);
    if (v.phase === 'ended') break;
    await autoStep(page);
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.getByTestId('replay').click(); // « Rejouer » ramène au salon
  await expect(page.getByTestId('mode-ghost')).toBeVisible();

  // Historique puis replay de la partie.
  await page.goto('/replays');
  await expect(page.getByTestId('watch')).toHaveCount(1);
  await page.getByTestId('watch').click();
  await expect(page).toHaveURL(/\/replays\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Replay · [1-9]\d*\//)).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('inscription refusée avant 21 ans', async ({ page }) => {
  await page.goto('/signup');
  const young = new Date();
  young.setFullYear(young.getFullYear() - 20);
  await page.getByTestId('name').fill('Trop Jeune');
  await page.getByTestId('email').fill(`jeune-${Date.now()}@example.com`);
  await page.getByTestId('password').fill('motdepasse1');
  await page.getByTestId('birth').fill(young.toISOString().slice(0, 10));
  await page.getByTestId('submit').click();
  await expect(page.getByRole('alert')).toContainText('au moins 21 ans');
});
