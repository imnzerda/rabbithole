import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/** Chaque test simule un appareil distinct (voir online.spec.ts). */
async function asDevice(context: BrowserContext): Promise<void> {
  const n = 1000 + Math.floor(Math.random() * 1e9);
  await context.addInitScript((v) => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => v });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => v });
  }, n);
}

async function signup(page: Page, label: string, next: string): Promise<void> {
  await page.goto(`/signup?next=${encodeURIComponent(next)}`);
  await page.getByTestId('name').fill(`Joueur ${label}`.slice(0, 24));
  await page.getByTestId('email').fill(`${label}-${Date.now()}@example.com`);
  await page.getByTestId('password').fill('motdepasse1');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(new RegExp(`${next.replace('/', '\\/')}$`));
}

/** Compte admin des tests (ADMIN_EMAILS du serveur de test), dans un contexte de requêtes à part. */
async function adminApi(request: APIRequestContext): Promise<void> {
  const data = { email: 'admin-e2e@example.com', password: 'motdepasse1' };
  const signupRes = await request.post('/api/auth/signup', { data: { ...data, displayName: 'Admin E2E', country: 'FR', locale: 'fr', fp: `admin-${Date.now()}` } });
  if (signupRes.status() !== 201) expect((await request.post('/api/auth/login', { data })).status()).toBe(200);
}

test.beforeEach(async ({ context }) => {
  await asDevice(context);
});

test('contenu sensible : masqué par défaut, affiché après le réglage ; signaler une carte', async ({ page, playwright, baseURL }, info) => {
  // Sur PC seulement : le test modifie une carte du serveur partagé, il ne doit pas tourner deux fois en parallèle.
  test.skip(info.project.name === 'mobile', 'Modifie le catalogue partagé : un seul projet.');
  // Une carte du catalogue devient « sensible » (outil d'admin), le temps du test.
  const admin = await playwright.request.newContext({ baseURL });
  await adminApi(admin);
  const [cardId, cardName] = ['proto_streamer', 'Le Streamer'];
  const card = await (await admin.get(`/api/admin/cards/${cardId}`)).json();
  const flagged = { ...card.def, flags: { ...card.def.flags, sensitive: true } };
  expect((await admin.put(`/api/admin/cards/${cardId}`, { data: { def: flagged } })).status()).toBe(200);

  try {
    await signup(page, `sensible-${info.project.name}`, '/collection');
    await page.request.post('/api/test/grant-kit');
    await page.reload();
    const grid = page.getByTestId('collection');
    await expect(grid.getByRole('button', { name: 'Carte masquée' })).toHaveCount(1);
    await expect(grid.getByRole('button', { name: cardName })).toHaveCount(0);

    // Fiche : avis de masquage, lien vers les réglages ; signalement.
    await grid.getByRole('button', { name: 'Carte masquée' }).click();
    await expect(page.getByText('Carte masquée : contenu sensible ou indisponible dans ton pays.')).toBeVisible();
    await page.getByTestId('report-card').click();
    await page.getByTestId('report-reason').selectOption('offensive');
    await page.getByTestId('report-send').click();
    await expect(page.getByTestId('report-dialog')).toContainText('Merci !');

    // Réglages : afficher le contenu sensible.
    await page.goto('/settings');
    await page.getByTestId('sensitive-toggle').check();
    await expect(page.getByRole('status')).toHaveText('Réglage enregistré.');
    await page.goto('/collection');
    await expect(page.getByTestId('collection').getByRole('button', { name: cardName })).toHaveCount(1);

    // Le signalement est arrivé dans la file de modération.
    const reports = (await (await admin.get('/api/admin/reports')).json()).reports as { card_id: string; reason: string }[];
    expect(reports.some((r) => r.card_id === cardId && r.reason === 'offensive')).toBe(true);
  } finally {
    await admin.put(`/api/admin/cards/${cardId}`, { data: { def: card.def } });
    await admin.dispose();
  }
});

test('demande de retrait publique (sans compte) et page Crédits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Demande de retrait' }).click();
  await expect(page).toHaveURL(/\/takedown$/);
  await page.getByTestId('takedown-card').selectOption('proto_figurant');
  await page.getByLabel('Ton nom').fill('Jean Martin');
  await page.getByLabel('E-mail de contact').fill('jean.martin@example.com');
  await page.getByLabel('Motif de la demande').fill('Je ne souhaite pas apparaître dans ce jeu.');
  await page.getByTestId('takedown-send').click();
  await expect(page.getByRole('status')).toContainText('Demande reçue. Elle sera traitée avant le');

  await page.goto('/credits');
  await expect(page.getByRole('heading', { name: 'Crédits' })).toBeVisible();
  await expect(page.getByText('CC BY-SA')).toBeVisible();
});
