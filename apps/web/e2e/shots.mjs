// Captures d'écran de contrôle visuel (hors suite de tests). Usage : node e2e/shots.mjs [dossier]
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] ?? 'shots';
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['Pixel 7'], locale: 'fr-FR' });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(base);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-menu.png` });

await page.getByTestId('deck-internet_party').click();
await page.getByTestId('play').click();
await page.waitForURL('**/play**');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/2-turn1.png` });

// Pose de la première carte jouable via le point d'accès de test.
const staged = await page.evaluate(() => {
  const rh = window.__rabbithole;
  const view = rh.view();
  for (let i = 0; i < view.hand.length; i++) if (rh.stage(i, 0)) return view.hand[i].defId;
  return null;
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-staged.png` });

for (let turn = 1; turn <= 4; turn++) {
  await page.evaluate(() => {
    const rh = window.__rabbithole;
    const view = rh.view();
    for (let i = view.hand.length - 1; i >= 0; i--) for (let t = 0; t < 3; t++) if (rh.stage(i, t)) break;
  });
  await page.getByTestId('end-turn').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="end-turn"]')?.hasAttribute('disabled') || document.querySelector('[data-testid="end-screen"]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${out}/4-turn5.png` });

// Fiche détail : appui long simulé sur la première carte de la main.
const box = await page.evaluate(() => window.__rabbithole.handCard(0));
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/5-detail.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
}

for (let i = 0; i < 4; i++) {
  if (await page.getByTestId('end-screen').isVisible().catch(() => false)) break;
  await page.getByTestId('end-turn').click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="end-turn"]')?.hasAttribute('disabled') || document.querySelector('[data-testid="end-screen"]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/6-end.png` });

console.log(JSON.stringify({ staged, errors }, null, 2));
await browser.close();
