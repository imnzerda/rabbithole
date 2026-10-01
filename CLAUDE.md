# RABBIT HOLE

TCG (jeu de cartes à collectionner) jouable dans le navigateur, sur desktop et mobile, pour un public adulte (21+). Les cartes représentent des personnes, événements, lieux et phénomènes réels issus de Wikipédia / Wikidata. La culture internet est l'ADN du jeu.

- Parties de 3 minutes en tours simultanés. Deck de 12 cartes, 3 terrains, 6 tours ; il faut gagner 2 terrains sur 3.
- Monétisation sans hasard à l'achat : boosters à contenu prévisualisé, pass, cosmétiques. Pas de pay-to-win.
- Accroche : *Fall into everything.*

**Cahier des charges complet : [rabbit-hole-spec.md](rabbit-hole-spec.md).**
**Avancement et prochaines étapes : [PROGRESS.md](PROGRESS.md).**

> Les règles de jeu ont été **simplifiées** le 2026-10-01 : un mot-clé = une phrase avec un chiffre, aucune règle cachée. Le cahier des charges est à jour. Les détails de résolution sont dans [packages/engine/README.md](packages/engine/README.md).

## Stack

Monorepo pnpm (`apps/web`, `apps/server`, `apps/admin`, `packages/engine`, `packages/shared`, `tools/pipeline`) :
- PixiJS v8 pour le rendu de jeu ; SvelteKit pour l'UI.
- Node.js + Fastify, avec WebSocket.
- PostgreSQL et Redis.
- Images sur Cloudflare R2.
- Tests : Vitest et Playwright.

```bash
pnpm install
pnpm test        # tous les tests
pnpm typecheck   # tsc strict sur tous les packages
```

## Règles non négociables

### Architecture
- **Serveur autoritaire.** Le serveur résout les parties, les tirages, l'économie, les achats, le trade-up et les échanges. Le client se contente d'afficher et d'animer.
- **Moteur déterministe** (`packages/engine`) : même état + mêmes actions + même seed = même résultat. Pas de `Math.random`, pas de `Date` dans le moteur. Le client peut simuler pour animer, mais c'est le serveur qui fait foi.
- **RNG serveur via `crypto`** pour tous les tirages. La seed est enregistrée pour l'audit.
- **Aucun tirage aléatoire côté client. Aucun crédit d'achat côté client.** Un achat n'est crédité que par un webhook serveur vérifié et idempotent (`provider_transaction_id` unique).
- **Équilibrage jamais codé en dur** : les valeurs vivent dans la config (`packages/engine/src/rules.ts`) ou en base.
- **TypeScript strict partout.** Aucune logique de jeu ou d'économie dans les composants d'UI.
- On teste le moteur avant d'écrire le rendu correspondant.

### Économie
- **Ne jamais implémenter de renouvellement payant des aperçus de boosters**, ni d'accélération payante du minuteur de 24 h.
- **Pas de booster à contenu caché en vente.** L'acheteur reçoit exactement l'aperçu. Seuls les boosters gratuits (récompenses) peuvent être aléatoires.
- Le trade-up et les échanges ne passent jamais par de l'argent réel ou des gemmes.
- Les probabilités sont toujours affichées : aperçus, trade-up, boosters gratuits.
- Aucun avantage de jeu achetable en dehors des boosters prévisualisés.

### Contenu
- Chaque carte passe la **politique de contenu** (section 5 du cahier des charges) avant publication. Exclusions strictes :
  - toute personne qui était mineure au moment des faits (en cas de doute, on exclut) ;
  - les victimes ;
  - le terrorisme ;
  - les personnes privées ;
  - les performeurs X ayant dénoncé une exploitation.
- Les textes sont décalés mais **jamais dégradants ni diffamatoires**, et aucune image n'est explicite.
- **Images libres uniquement** : domaine public, CC0, CC BY, CC BY-SA. Chaque image a un crédit enregistré. Les licences NC, ND et fair use sont refusées.
- Le contenu `adult` est filtré par pays (`country_rules`).
- Âge minimum : 21 ans.

### Méthode de travail
- On avance **phase par phase** (section 19 du cahier des charges) et on **demande validation à la fin de chaque phase**.
- On met à jour [PROGRESS.md](PROGRESS.md) à chaque étape importante.
- On écrit en français : code commenté, docs, échanges.

## Repères dans le code

- [packages/engine/](packages/engine/) : moteur de règles, avec un README qui décrit l'API, les règles simplifiées et les choix de résolution.
  - `match.ts` : cycle de partie (création, tours, Hype, Lâcher, décompte).
  - `keywords.ts` : mots-clés.
  - `actions.ts` : DSL d'effets.
  - `query.ts` : ciblage, filtres et conditions.
  - `power.ts` : calcul de la puissance et du décompte.
  - `view.ts` : ce qu'un joueur voit, sans information cachée.
  - `validate.ts` : validation des cartes et des decks.
  - `glossary.ts` : texte des mots-clés, généré depuis la config.
- `packages/engine/test/` : `fixtures.ts` contient les terrains d'exemple et un pool qui couvre tous les mots-clés ; `helpers.ts` fournit un bac à sable (`sandbox`) pour écrire des scénarios.
