// Captures d'écran de contrôle visuel (hors suite de tests). Usage : node e2e/shots.mjs [dossier]
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] ?? 'shots';
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['Pixel 7'], locale: 'fr-FR' });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const ready = () =>
  page.waitForFunction(() => {
    const rh = window.__rabbithole;
    return rh && rh.view() && !rh.busy() && (rh.view().legal || rh.view().phase === 'ended');
  }, null, { timeout: 60000 });

/** Joue une décision simple : poser, attaquer le Leader, sinon finir le tour ; ne jamais défendre. */
const step = () =>
  page.evaluate(async () => {
    const rh = window.__rabbithole;
    const v = rh.view();
    const legal = v.legal;
    if (!legal) return 'none';
    switch (legal.kind) {
      case 'mulligan':
        await rh.act({ type: 'mulligan', redraw: false });
        return 'mulligan';
      case 'block':
        await rh.act({ type: 'block', blocker: null });
        return 'block';
      case 'counter':
        await rh.act({ type: 'counter', uids: [] });
        return 'counter';
      case 'trigger':
        await rh.act({ type: 'trigger', activate: true });
        return 'trigger';
      case 'main': {
        if (legal.playable[0]) {
          await rh.act({ type: 'play', uid: legal.playable[0] });
          return 'play';
        }
        const a = legal.attackers[0];
        if (a) {
          await rh.act({ type: 'attack', attacker: a.uid, target: a.targets[0] });
          return 'attack';
        }
        await rh.act({ type: 'end_turn' });
        return 'end';
      }
    }
  });

await page.goto(base);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-menu.png` });

await page.getByTestId('deck-internet_party').click();
await page.getByTestId('play').click();
await page.waitForURL('**/play**');
await ready();
await page.screenshot({ path: `${out}/2-start.png` });

let shotDefense = false;
let shotMid = false;
for (let i = 0; i < 400; i++) {
  await ready();
  const v = await page.evaluate(() => window.__rabbithole.view());
  if (v.phase === 'ended') break;
  if (!shotDefense && v.legal && (v.legal.kind === 'counter' || v.legal.kind === 'block')) {
    shotDefense = true;
    await page.screenshot({ path: `${out}/4-defense.png` });
  }
  if (!shotMid && v.turn >= 7 && v.legal?.kind === 'main') {
    shotMid = true;
    await page.screenshot({ path: `${out}/3-midgame.png` });
    const box = await page.evaluate(() => window.__rabbithole.handCard(0));
    if (box) {
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/5-detail.png` });
      await page.getByRole('button', { name: 'Fermer' }).click();
    }
  }
  await step();
}
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/6-end.png` });

console.log(JSON.stringify({ errors, shotDefense, shotMid }, null, 2));
await browser.close();
