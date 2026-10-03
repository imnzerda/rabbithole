import { expect, test } from '@playwright/test';

/**
 * Outil d'administration (apps/admin, port 5174) : du candidat du pipeline à la carte jouable.
 * Les cookies ne dépendent pas du port : la session ouverte sur le site vaut pour l'admin.
 */
const ADMIN = 'http://localhost:5174';
const EMAIL = 'admin-e2e@example.com';

test.skip(({ isMobile }) => isMobile, 'Outil interne : sur PC uniquement.');

test('admin : import des candidats, carte créée, éditée, publiée, jouable ; suppression manuelle et compensation', async ({ page, request, browser, baseURL }) => {
  // Compte admin (listé dans ADMIN_EMAILS du serveur de test) : inscription, ou connexion s'il existe déjà.
  const signup = await page.request.post('/api/auth/signup', {
    data: { email: EMAIL, password: 'motdepasse1', displayName: 'Admin E2E', country: 'FR', locale: 'fr', fp: `admin-fp-${Date.now()}` },
  });
  if (signup.status() !== 201) {
    expect((await page.request.post('/api/auth/login', { data: { email: EMAIL, password: 'motdepasse1' } })).status()).toBe(200);
  }

  const stamp = Date.now().toString(36);
  const series = `e2e_${stamp}`;
  const qid = `Q9${Math.floor(Math.random() * 1e8)}`;

  await page.goto(`${ADMIN}/series`);
  await page.getByPlaceholder('identifiant').fill(series);
  await page.getByPlaceholder('Nom (fr)').fill('Série E2E');
  await page.getByPlaceholder('Nom (en)').fill('E2E series');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByText(series, { exact: true })).toBeVisible();

  // Import d'un fichier du pipeline (un candidat « à revoir »).
  await page.goto(`${ADMIN}/candidates`);
  const run = {
    series,
    candidates: [
      {
        qid,
        kind: 'person',
        categories: ['exploration'],
        labels: { fr: `Exploratrice ${stamp}`, en: `Explorer ${stamp}` },
        descriptions: { fr: 'exploratrice polaire' },
        countries: ['FR'],
        sitelinks: 50,
        score: { total: 92, iconic: false, meetsThreshold: true },
        policy: { status: 'needs_review', reasons: ['career_start_unknown'] },
        flags: {},
        imageInfo: null,
      },
    ],
  };
  await page.getByTestId('import').setInputFiles({ name: `${series}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(run)) });
  await expect(page.getByText('Import : 1 nouveaux candidats, 0 mis à jour.')).toBeVisible();
  await page.getByPlaceholder('Nom ou Q-id').fill(qid);
  await page.getByRole('button', { name: 'Filtrer' }).click();
  await page.getByRole('combobox').filter({ hasText: series }).selectOption(series);
  await page.getByRole('button', { name: 'Créer la carte' }).click();

  // Éditeur : stats, texte d'ambiance, enregistrement.
  await expect(page).toHaveURL(new RegExp(`/cards/${series}_explorer_`));
  const cardId = decodeURIComponent(page.url().split('/cards/')[1]!);
  await page.getByLabel('Puissance').fill('5');
  await page.getByPlaceholder("Texte d'ambiance (fr) : décalé, jamais dégradant").fill('A planté son drapeau avant tout le monde.');
  await expect(page.getByText('sous le seuil')).toHaveCount(0);
  await page.getByTestId('save').click();
  await expect(page.getByRole('status')).toContainText('Enregistré (version 2)');

  // Carte « à revoir » : l'information est affichée, la publication n'est pas bloquée.
  await expect(page.getByText('career_start_unknown')).toBeVisible();
  await page.getByRole('button', { name: 'Passer en relecture' }).click();
  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByRole('status')).toContainText('Statut : Publiée.');

  // La série publiée, la carte entre dans le catalogue joué.
  await page.goto(`${ADMIN}/series`);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('row', { name: new RegExp(series) }).getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByText(new RegExp(`Série ${series} : Publiée`))).toBeVisible();
  const catalog = await (await request.get('/api/catalog')).json();
  expect(catalog.cards.map((c: { id: string }) => c.id)).toContain(cardId);

  await page.goto(`${ADMIN}/audit`);
  await expect(page.getByText('card.published').first()).toBeVisible();

  // Enlever une carte à la main : un brouillon jamais publié est effacé.
  const draft = await page.request.post(`${ADMIN}/api/admin/cards`, { data: { series, type: 'character', name: `Brouillon ${stamp}` } });
  const draftId = (await draft.json()).card.id as string;
  await page.goto(`${ADMIN}/cards/${encodeURIComponent(draftId)}`);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('remove-card').click();
  await expect(page).toHaveURL(/\/cards$/);
  expect((await page.request.get(`${ADMIN}/api/admin/cards/${encodeURIComponent(draftId)}`)).status()).toBe(404);

  // Une carte publiée est retirée, jamais effacée : son détenteur reçoit des pièces et une notification.
  const player = await browser.newContext({ baseURL, locale: 'fr-FR' });
  const playerPage = await player.newPage();
  const joined = await playerPage.request.post('/api/auth/signup', {
    data: { email: `joueur-${stamp}@example.com`, password: 'motdepasse1', displayName: 'Joueur E2E', country: 'FR', locale: 'fr', fp: `player-fp-${stamp}` },
  });
  expect(joined.status()).toBe(201);
  await playerPage.request.post('/api/test/set-card', { data: { cardId, quantity: 2 } });
  await page.goto(`${ADMIN}/cards/${encodeURIComponent(cardId)}`);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('remove-card').click();
  await expect(page.getByText('Ses détenteurs ont reçu son prix de fabrication en pièces')).toBeVisible();
  expect((await (await page.request.get(`${ADMIN}/api/admin/cards/${encodeURIComponent(cardId)}`)).json()).status).toBe('retired');
  await playerPage.goto('/');
  await expect(playerPage.getByTestId('notice')).toContainText('a été retirée du jeu : tu as reçu 40 🪙 pour 2 exemplaire(s).');
  await playerPage.getByTestId('notice').getByRole('button', { name: 'OK' }).click();
  await expect(playerPage.getByTestId('notice')).toHaveCount(0);
  await player.close();
});
