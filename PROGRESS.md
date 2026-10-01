# Avancement

## Phase en cours

**Phase 3 — Serveur et comptes** : terminée, en attente de validation. Branche `phase-3-serveur`.

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée |
| 2. Prototype jouable local | ✅ Validée (fusionnée dans `master`) |
| 2 bis. Refonte du duel (One Piece) | ✅ Validée (fusionnée dans `master`) |
| 3. Serveur et comptes | ✅ Terminée, en attente de validation |
| 4. Pipeline de contenu et admin | ⏳ Prochaine |
| 5. Économie | — |
| 6. Rétention | — |
| 7. Social | — |
| 8. International et lancement | — |

**Lancer le jeu :** `pnpm install` puis `pnpm dev` (serveur de jeu sur le port 3000 et site sur le port 5173), et ouvrir http://localhost:5173. `pnpm dev:lan` fait de même, en accessible depuis un téléphone du même Wi-Fi. Aucune base à installer : en développement, PostgreSQL tourne en embarqué (PGlite, données dans `apps/server/.data/`). `?timer=0` dans l'URL d'entraînement désactive les minuteurs.

## Journal

### 2026-10-02 — Phase 3 : serveur et comptes

**Serveur (`apps/server`)** : Fastify, WebSocket, PostgreSQL.
- **Base** : SQL paramétré sans ORM, migrations versionnées (`src/db/migrations`).
  - En production : PostgreSQL via `DATABASE_URL` (Neon).
  - En développement et en test : **PGlite**, un vrai PostgreSQL embarqué, rien à installer.
- **Comptes** : date de naissance obligatoire et **accès refusé avant 21 ans**.
  - Mots de passe hachés en Argon2.
  - Sessions par jeton aléatoire dont seule l'empreinte est stockée, dans un cookie httpOnly / SameSite.
  - Limitation de débit sur l'authentification ; même message d'erreur que le compte existe ou non.
- **Kit de départ** (prototype) : les 5 Leaders, 2 exemplaires de chaque carte, et les 5 decks préconstruits.
- **Collection et decks** (REST) : les decks sont validés par le moteur **et** par la possession des cartes.
- **Parties en temps réel** (`/ws`), le **serveur fait foi** :
  - seed issue de `crypto` ;
  - actions validées par le moteur ;
  - chaque joueur ne reçoit que sa vue et des événements filtrés (la pioche et les Vies adverses restent cachées) ;
  - minuteurs côté serveur, avec action par défaut à l'expiration ;
  - reconnexion avec reprise de la partie.
- **Matchmaking** : partie rapide, classée, ou contre un fantôme. Si personne ne se présente dans le délai (15 s), un **fantôme** prend le relais : le deck enregistré d'un autre joueur, joué par l'IA.
- **Replays** : chaque partie est enregistrée (version du contenu, seed, decks, actions, résultat). Historique et replay sont réservés aux participants.
- `packages/shared` : types du protocole WebSocket et de l'API, partagés entre le serveur et le site.
- Moteur : ajout de `eventsFor` (filtrage des événements par joueur) et de `timeoutAction` (action par défaut du minuteur).

**Site (`apps/web`)**
- Pages **Connexion** et **Inscription** (rappel 21+, erreurs claires).
- **Salon en ligne** : choix parmi ses decks, trois modes, recherche avec compte à rebours avant le fantôme.
- **Mes parties** : historique avec résultat, puis **replay** joué par le moteur à partir de la seed, avec Pause, Lecture et Action suivante.
- Le composant `Game` affiche indifféremment une partie locale (entraînement contre l'IA), une partie en ligne ou un replay, à travers une interface `MatchClient` qui reçoit les étapes en continu.
- Le menu propose « Jouer en ligne » en premier, l'entraînement hors ligne en second, et une barre de compte.

**Tests** : 70 moteur, 6 contenu, **16 serveur** et **14 E2E**. Les tests serveur couvrent :
- comptes, âge, sessions, decks et possession ;
- deux joueurs connectés jusqu'à la fin de partie, sans fuite d'information ;
- fantôme, minuteurs et reconnexion ;
- replay qui reproduit exactement le résultat.

Les tests E2E couvrent, sur smartphone et sur PC : l'inscription, une partie en ligne complète, l'historique, le replay et le refus avant 21 ans.

**Reste pour l'hébergement (phase 8)** : un adaptateur Redis (Upstash) pour la file et les sessions si plusieurs serveurs tournent, les Dockerfiles et `fly.toml`. Aujourd'hui, les parties en cours sont en mémoire : un redémarrage du serveur interrompt les parties non terminées.


### 2026-10-02 — Affichage adapté au PC et au smartphone

- **Deux dispositions du plateau**, choisies automatiquement selon la forme de l'écran et recalculées au redimensionnement :
  - **paysage (PC, tablette)** : Leaders, Vies et Buzz à gauche, Personnages au centre, main sur toute la largeur, zone libre à droite pour les cartes jouées et les panneaux ;
  - **portrait (smartphone)** : disposition compacte (600 px logiques au lieu de 720), donc tout est environ 20 % plus gros à l'écran.
- **Lisibilité** :
  - texte des cartes agrandi (nom, mots-clés, coût, puissance, Contre, Buzz) ;
  - les noms trop longs réduisent leur police pour tenir ;
  - l'étiquette Leader/Événement passe en bas de la carte.
- **Smartphone** : la carte touchée dans la main passe au premier plan, agrandie de 20 %. Elle reste lisible même avec 9 cartes en main.
- **PC** :
  - **aperçu de carte au survol** de la souris, dans la zone libre à droite ;
  - le panneau de défense se range à droite au lieu de couvrir la main ;
  - les boutons sont regroupés à droite ;
  - le menu des decks s'affiche en grille sur plusieurs colonnes.
- **Tests E2E** : les 5 scénarios tournent sur smartphone (Pixel 7) et sur PC (1600×900), soit 10 tests, tous verts.

### 2026-10-02 — Refonte du duel : modèle TCG One Piece

Décisions :
- **modèle One Piece complet** ;
- **tour par tour** ;
- **Leader = carte célèbre**, qui fixe les 2 catégories du deck.

Le modèle précédent (3 terrains, tours simultanés) est remplacé. Le cahier des charges est à jour (sections 1, 3, 4, 12, 15, 16 et 19).

**Moteur (`packages/engine`), réécrit**
- Leader avec Vies (4-5) et un pouvoir. Deck de 20 cartes, 2 exemplaires au plus, uniquement dans les catégories du Leader.
- Mulligan, pioche et **Buzz** (+2 par tour, 10 au maximum, +1 de puissance quand il est attaché).
- Personnages (5 en jeu au maximum) et Événements ([Principale], [Contre]).
- Combat : on attaque le Leader ou un Personnage épuisé. Le défenseur peut bloquer avec un **Bloqueur**, puis jouer des **Contres** depuis sa main. L'attaque passe si sa puissance est au moins égale.
- Une Vie perdue va dans la main, sauf si son **Déclencheur** est activé. Victoire par KO du Leader ou quand l'adversaire doit piocher avec une pioche vide.
- 11 mots-clés : Élan, Bloqueur, Viral, Ratio, Clickbait, Croissance, Rickroll, Cancel, Séduction, Shitpost et Tendance.
- Moments d'effet : [Jouée], [Attaque], [KO], [Déclencheur], [Continu], [Activation : principale], [Fin de ton tour]. Les cibles sont choisies automatiquement.
- Nouvelle API par actions : `applyAction`, `legalActions` et `pendingDecision`. La vue joueur inclut les actions légales.
- IA (`chooseAction`) : elle pose ses cartes, attache du Buzz pour faire passer ses attaques, attaque, bloque, contre au plus juste et active les Déclencheurs.
- **68 tests**, dont 300 parties aléatoires avec vérification des invariants (conservation du Buzz, zones…). L'IA bat un joueur aléatoire plus de 85 % du temps.

**Contenu (`packages/content`)**
- 5 Leaders, un par paire de catégories :
  - L'Influenceuse (Internet + Musique) ;
  - Le Président (Guerre + Sport) ;
  - La Baronne du Crime (Crimes + Mystères) ;
  - Le Professeur (Science + Exploration) ;
  - La Star de Cinéma (Séries + Nuits).
- 50 cartes, 5 par catégorie (4 Personnages + 1 Événement), plus 2 jetons. 5 decks préconstruits.
- **Rééquilibrage** par simulation IA contre IA : 400 parties par confrontation, en alternant qui commence, et 4 passes de réglage. Résultat : chaque deck gagne entre **43 % et 59 %** de ses parties, le premier joueur gagne 48 % du temps, et une partie dure 10,7 tours en moyenne (≈ 5 par joueur).

  | Deck | Victoires |
  |---|---|
  | Coups tordus | 59 % |
  | Tapis rouge | 53 % |
  | Ordre et pouvoir | 51 % |
  | Internet Party | 44 % |
  | La longue route | 43 % |

**Web (`apps/web`)**
- **Plateau portrait** : Leader et Personnages de chaque camp, Vies et Buzz affichés, main en bas. Les cartes épuisées pivotent comme dans One Piece.
- **Jouer et attaquer** : glisser une carte vers le haut pour la jouer, glisser une carte prête sur une cible pour attaquer (ou tap puis tap). Les cartes jouables, prêtes ou ciblables sont surlignées.
- **Boutons contextuels** : Jouer, +1 ⚡, Activer.
- **Panneau de décision** en bas d'écran pour le mulligan, le blocage, les contres (avec un calcul en direct du type « Défense : 7 — paré ») et les Déclencheurs.
- **Animations** étape par étape : tour adverse, attaques, contres, KO, Vies perdues. Les Événements et Déclencheurs sont montrés en grand.
- **Minuteurs** : 60 s par tour, 20 s par réaction, avec une action par défaut à l'expiration.
- **5 tests E2E Playwright**, tous verts : menu, mulligan, partie complète, glisser-déposer réel, fiche carte et règles. Aucune erreur console.

### 2026-10-01 — Phase 2 : prototype jouable local (modèle « terrains », remplacé depuis)

- `apps/web` (SvelteKit + PixiJS 8) : menu, plateau, animations pilotées par les événements du moteur, fiche carte à l'appui long, règles, écran de fin.
- Interface `MatchClient` : l'UI ne voit que des vues et des événements. `LocalMatch` fait tourner la partie dans le navigateur, **pour le prototype uniquement** ; en phase 3, le serveur fera foi.
- `packages/content` : cartes de test fictives (archétypes) en JSON.
- `apps/web` utilise TypeScript 5.9, car `svelte-check` a besoin de l'API JS que TypeScript 7 n'expose plus.

### 2026-10-01 — Phase 1 : moteur de règles (modèle « terrains », remplacé depuis)

- Monorepo pnpm, TypeScript strict (`noUncheckedIndexedAccess`), Vitest.
- Premier moteur : 3 terrains, tours simultanés, DSL d'effets, mots-clés, Hype, déterminisme par seed.
- Simplification des règles demandée : un mot-clé = une phrase avec un chiffre, aucune règle cachée. Ce principe est conservé dans le modèle duel.
- Fichiers projet : `rabbit-hole-spec.md`, `CLAUDE.md`, `PROGRESS.md`.

## Prochaines étapes

### Phase 4 — Pipeline de contenu et admin
1. `tools/pipeline` : extraction Wikidata (SPARQL), score de notoriété (sitelinks + Pageviews), pré-filtrage de la politique de contenu (section 5), images Commons avec filtre de licences, carte typographique de secours.
2. `apps/admin` : éditeur de cartes et de Leaders (DSL validé par `validateCardDef`), budget de puissance, simulations IA contre IA pour l'équilibrage, file des demandes de retrait, `country_rules`, journal d'audit.
3. Catalogue en base (tables `cards`, `card_images`, `series`) à la place du JSON du prototype.
4. Production du set de base (personnes, événements et lieux réels) : 250 cartes et les Leaders.

### Questions ouvertes
- Faut-il réintroduire les terrains sous forme de cartes **Lieu** dans une prochaine série ?
- Faut-il affiner l'équilibrage avec de vraies parties (Coups tordus reste un peu au-dessus) ?
- La branche `phase-3-serveur` peut-elle être fusionnée dans `master` ?
