import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __rabbithole: {
      view: () => { turn: number; mana: number; hand: { uid: string; defId: string }[]; phase: string } | null;
      stage: (handIndex: number, terrain: number) => boolean;
      handCard: (handIndex: number) => { x: number; y: number } | null;
    };
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="end-screen"]') ||
      (window.__rabbithole?.view() && !document.querySelector('[data-testid="end-turn"]')?.hasAttribute('disabled')),
    null,
    { timeout: 30_000 },
  );
}

test('menu : 4 decks, lancement d’une partie', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RABBIT HOLE' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByTestId('deck-coups_tordus').click();
  await page.getByTestId('play').click();
  await expect(page).toHaveURL(/\/play\?deck=coups_tordus/);
  await waitReady(page);
  await expect(page.getByTestId('turn')).toHaveText('Tour 1/6');
  expect(errors).toEqual([]);
});

test('partie complète jusqu’à l’écran de fin, puis Rejouer', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/play?deck=internet_party&timer=0');
  await waitReady(page);
  for (let turn = 1; turn <= 6; turn++) {
    await expect(page.getByTestId('turn')).toHaveText(`Tour ${turn}/6`);
    // Pose tout ce qui est abordable, terrain par terrain.
    await page.evaluate(() => {
      const rh = window.__rabbithole;
      const hand = rh.view()?.hand ?? [];
      for (let i = hand.length - 1; i >= 0; i--) for (let t = 0; t < 3 && !rh.stage(i, t); t++);
    });
    await page.getByTestId('end-turn').click();
    await waitReady(page);
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.getByTestId('replay').click();
  await expect(page.getByTestId('end-screen')).toBeHidden();
  await expect(page.getByTestId('turn')).toHaveText('Tour 1/6');
  expect(errors).toEqual([]);
});

test('poser une carte consomme de l’énergie', async ({ page }) => {
  await page.goto('/play?deck=ordre_et_pouvoir&timer=0');
  await waitReady(page);
  await page.getByTestId('end-turn').click(); // tour 2 : 2 d'énergie
  await waitReady(page);
  const staged = await page.evaluate(() => {
    const rh = window.__rabbithole;
    const hand = rh.view()?.hand ?? [];
    for (let i = 0; i < hand.length; i++) if (rh.stage(i, 0)) return true;
    return false;
  });
  test.skip(!staged, 'Aucune carte abordable dans cette main');
  await expect(page.getByTestId('mana')).not.toContainText(/^2/);
});

test('appui long sur une carte : fiche détaillée ; aide des règles', async ({ page }) => {
  await page.goto('/play?deck=longue_route&timer=0');
  await waitReady(page);
  await page.waitForTimeout(800); // fin de l'arrivée animée de la main
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
  await expect(page.getByRole('dialog')).toContainText('Les règles en 30 secondes');
  await expect(page.getByRole('dialog')).toContainText('Gagne 2 des 3 terrains');
});
