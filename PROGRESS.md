# Avancement

## Phase en cours

**Phase 2 — Prototype jouable local** : terminée, en attente de validation. Branche `phase-2-prototype`.

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée (règles simplifiées) |
| 2. Prototype jouable local | ✅ Terminée, en attente de validation |
| 3. Serveur et comptes | ⏳ Prochaine |
| 4. Pipeline de contenu et admin | — |
| 5. Économie | — |
| 6. Rétention | — |
| 7. Social | — |
| 8. International et lancement | — |

**Lancer le prototype :** `pnpm install` puis `pnpm dev`, et ouvrir http://localhost:5173. L'outil de développement du navigateur en vue mobile donne le meilleur rendu. `?timer=0` dans l'URL de partie désactive le minuteur.

## Journal

### 2026-10-01 — Phase 2 : prototype jouable local

**Moteur (`packages/engine`)**
- **IA simple** (`chooseAiPlays`, `aiWantsHype`, `aiWantsFold`). Elle ne lit que la vue publique du joueur, donc elle ne triche pas. Elle est gloutonne et privilégie les terrains disputés.
  - Elle gagne 87 % des parties contre un joueur aléatoire et dépense presque toute son énergie.
  - Elle est réutilisable pour le mode fantôme.
- **Texte des cartes généré depuis le DSL** (`effectText`, `cardText`, FR/EN), par exemple « À la révélation : Gagne +3 s'il y a au moins 2 autre(s) carte(s) Musique ici. ».
- Les événements portent la puissance effective (révélation, changement de puissance, création), ce qui permet une animation exacte.
- La vue joueur donne le coût de chaque carte de la main sur chaque terrain.

**Contenu (`packages/content`)**
- 40 cartes de test en JSON (+ 2 jetons générés en partie), 10 terrains et 4 decks préconstruits : Internet Party, Ordre et pouvoir, Coups tordus, La longue route.
- Ce sont des **archétypes fictifs** (« Le Streamer », « La Diva »…). Les personnes réelles arriveront en phase 4, via le pipeline et la politique de contenu.
- La courbe de coût de la section 4.3 est respectée exactement (8/10/8/6/5/3). Les 10 catégories sont présentes, avec une carte multi-catégorie.
- Équilibrage approximatif par simulations IA contre IA. Il reste un écart : « Coups tordus » bat « Ordre et pouvoir » environ 3 fois sur 4. Les autres confrontations sont entre 53 % et 68 %. À affiner avec de vraies parties : tout est dans le JSON.

**Application web (`apps/web`)** : SvelteKit + PixiJS 8
- **Menu** : logo animé « terrier » et choix du deck. L'adversaire IA prend un autre deck au hasard.
- **Plateau PixiJS**, pensé pour un écran portrait :
  - 3 terrains, 4 emplacements par camp ;
  - la main en bas ;
  - les puissances par terrain, en vert pour le camp qui mène et en rouge pour l'autre.
- **Poser une carte** : glisser-déposer, ou tap sur la carte puis tap sur le terrain (pratique sur mobile). Un tap sur une carte posée la reprend. Les terrains jouables s'éclairent.
- **Révélation animée** pilotée par les événements du moteur :
  - les cartes adverses arrivent face cachée puis se retournent ;
  - les gains et pertes s'affichent en chiffres flottants, avec le nom des mots-clés ;
  - destructions, déplacements, vols et copies sont animés ;
  - des bandeaux annoncent le tour et la Hype.
- **Lisibilité** :
  - appui long sur une carte : fiche « Qui c'est ? » (texte de règle généré, rareté, texte d'ambiance) ;
  - tap sur un terrain : son effet ;
  - écran « Règles en 30 secondes » avec le glossaire des mots-clés.
- **Design typographique de secours** (section 10.4) : couleur et symbole par catégorie, cadre de rareté distinct en forme et en couleur (daltonisme), dos de carte en spirale « terrier ».
- **Commandes** : énergie restante, Hype, Lâcher, Fin de tour, et minuteur de 30 s qui finit le tour automatiquement.
- **Fin de partie** : victoire, défaite ou égalité, avec la raison, les points de rang (enjeu) et le score par terrain. Boutons Rejouer et Menu.
- **Architecture prête pour la phase 3** : l'UI ne parle qu'à une interface `MatchClient` (vues + événements). `LocalMatch` fait tourner le moteur et l'IA dans le navigateur, avec une seed issue de `crypto.getRandomValues`. C'est **uniquement pour le prototype** : en phase 3, une implémentation WebSocket la remplacera et le serveur fera foi.
- i18n minimale par clés (FR/EN, selon la langue du navigateur).

**Tests**
- 114 tests sur le moteur et 8 sur le contenu, tous verts.
- 4 tests E2E Playwright, tous verts (mobile Pixel 7) :
  - menu ;
  - partie complète jusqu'à l'écran de fin, puis Rejouer ;
  - consommation d'énergie ;
  - appui long et écran des règles.
- `apps/web/e2e/shots.mjs` : captures d'écran de contrôle. Aucune erreur console.
- `apps/web` utilise TypeScript 5.9, car `svelte-check` a besoin de l'API JS que TypeScript 7 n'expose plus. Le reste du monorepo est en TypeScript 7.

### 2026-10-01 — Phase 1 : moteur de règles

**Mise en place**
- Monorepo pnpm, TypeScript strict (`noUncheckedIndexedAccess`), Vitest.

**`packages/engine`**
- Partie complète : création (decks mélangés selon la seed, terrains tirés au sort), tours simultanés (pose face cachée puis révélation ordonnée), décompte, Hype, Lâcher.
- Contraintes de jeu : terrains révélés aux tours 1, 2 et 3, 4 cartes max par camp et par terrain, main de 7 max, mana égal au numéro du tour.
- Le DSL d'effets complet du cahier des charges, avec en plus :
  - les déclencheurs `start_of_turn` et `end_of_turn` ;
  - des conditions combinables et des montants dynamiques ;
  - des filtres de cartes.
- Les 10 mots-clés et les modificateurs de terrain.
- `getPlayerView` : ce qu'un joueur a le droit de voir.
- `validateCardDef`, `validateCatalog` et `validateDeck`.
- Glossaire (`keywordText`, `rulesSummary`, FR/EN) généré depuis la config.
- État en JSON pur avec RNG seedé, ce qui permet le replay à partir de seed + decks + actions.

**Simplification des règles** (pour rendre le jeu compréhensible par tous) :
- Clickbait devient un vrai bonus de +4.
- Ratio devient −3 sans condition.
- Rickroll envoie la carte adverse la plus forte ailleurs.
- Cancel fait perdre ses effets à la carte adverse la plus forte.
- Live est fusionné dans Croissance.
- Shitpost donne entre +0 et +8.
- Hype : doublement immédiat, ×4 max.
- On ne pose que sur les terrains visibles.

Le cahier des charges a été mis à jour. Détails dans [packages/engine/README.md](packages/engine/README.md).

**Fichiers projet** : `rabbit-hole-spec.md`, `CLAUDE.md`, `PROGRESS.md`. Premier commit sur `master`.

## Prochaines étapes

### Phase 3 — Serveur et comptes
1. `apps/server` : Fastify + PostgreSQL (schéma de la section 16), migrations, Redis.
2. Comptes avec date de naissance obligatoire et accès refusé avant 21 ans. Authentification.
3. Collections et decks (CRUD, validation par `validateDeck`).
4. **WebSocket `/match`** :
   - matchmaking ;
   - seed issue de `crypto` côté serveur, enregistrée ;
   - poses validées par `validatePlays` ;
   - envoi de `getPlayerView` et d'événements **filtrés** (rien sur la main adverse) ;
   - timer de 30 s côté serveur.
5. Implémentation WebSocket de `MatchClient` dans `apps/web`, à la place de `LocalMatch`.
6. Mode fantôme (IA sur un deck enregistré, si le matchmaking dépasse 15 s) et replays (seed + decks + actions).

### Questions ouvertes
- Faut-il réduire encore les mots-clés du set de base (de 10 à 6–7, par exemple en retirant Séduction et Shitpost) ?
- Faut-il rééquilibrer « Coups tordus » contre « Ordre et pouvoir » maintenant, ou attendre de vraies parties ?
- La branche `phase-2-prototype` peut-elle être fusionnée dans `master` ?
