import { expect, test } from '@playwright/test';

/**
 * Outil d'administration (apps/admin, port 5174) : du candidat du pipeline à la carte jouable.
 * Les cookies ne dépendent pas du port : la session ouverte sur le site vaut pour l'admin.
 */
const ADMIN = 'http://localhost:5174';
const EMAIL = 'admin-e2e@example.com';

test.skip(({ isMobile }) => isMobile, 'Outil interne : sur PC uniquement.');

test('admin : import des candidats, carte créée, éditée, validée, publiée, jouable', async ({ page, request }) => {
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

  // Publication bloquée tant que la politique de contenu n'est pas validée.
  await page.getByRole('button', { name: 'Passer en relecture' }).click();
  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByRole('alert')).toContainText('validation humaine requise');
  await page.getByPlaceholder('Note de validation (obligatoire)').fill('Adulte au début de carrière (vérifié), faits publics.');
  await page.getByRole('button', { name: 'Valider la politique de contenu' }).click();
  await expect(page.getByRole('status')).toContainText('Politique de contenu validée.');
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
});
