# Avancement

## Phase en cours

**Phase 4 — Pipeline de contenu et admin** : en cours (étape 1/5 terminée : catalogue en base).

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée |
| 2. Prototype jouable local | ✅ Validée (fusionnée dans `master`) |
| 2 bis. Refonte du duel (One Piece) | ✅ Validée (fusionnée dans `master`) |
| 3. Serveur et comptes | ✅ Validée (fusionnée dans `master`) |
| 4. Pipeline de contenu et admin | 🟡 En cours |
| 5. Économie | 🟡 Bases avancées (pièces, aperçus, boosters gratuits, recyclage, crafting) |
| 6. Rétention | — |
| 7. Social | — |
| 8. International et lancement | — |

**Lancer le jeu :** `pnpm install` puis `pnpm dev` (serveur de jeu sur le port 3000 et site sur le port 5173), et ouvrir http://localhost:5173. `pnpm dev:lan` fait de même, en accessible depuis un téléphone du même Wi-Fi. Aucune base à installer : en développement, PostgreSQL tourne en embarqué (PGlite, données dans `apps/server/.data/`). `?timer=0` dans l'URL d'entraînement désactive les minuteurs.

## Journal

### 2026-10-02 — Phase 4, étape 1 : catalogue de cartes en base

Plan de la phase 4 : (1) catalogue en base, (2) `tools/pipeline` (Wikidata, notoriété, politique de contenu, images Commons), (3) `apps/admin`, (4) côté joueur : signalement, interrupteur « contenu sensible », crédits, demande de retrait, (5) premier lot de cartes réelles.

- **Tables** (migration `006`) : `series`, `cards` (définition jouable du moteur en JSON, statut `draft` → `review` → `published` → `retired`), `card_images` (crédits complets), `catalog_versions`, et un **rôle** sur les comptes (`player` / `admin`).
- **Catalogue** (`apps/server/src/catalog/catalog.ts`) : seules les cartes publiées d'une série publiée sont jouables, dans les boosters, les decks et les parties. Au premier démarrage, les cartes du prototype deviennent la série `prototype` (et les jetons, une série non collectionnable).
- **Versions** : chaque état publié a une version (`cat@…`), enregistrée avec chaque partie et conservée : un replay se rejoue avec les cartes de sa partie, même après une publication. Une partie en cours garde son catalogue.
- **API** : `GET /api/catalog` (version, règles, cartes, cartes à collectionner) et `GET /api/catalog/:version`.
- **Site** : Collection, Decks, Salon en ligne et Replays lisent le catalogue du serveur au lieu du JSON embarqué. Si une partie démarre sur une autre version, la page se recharge. L'entraînement hors ligne garde le contenu embarqué du prototype.
- **Tests** : 50 serveur (dont 4 sur le catalogue), 20 E2E.


### 2026-10-02 — HWID retiré, empreinte numérique seule

- Le **HWID** est supprimé (code, configuration, données : migration `005`). L'appareil est reconnu par son **empreinte numérique** (`apps/web/src/lib/fingerprint.ts`), qui reprend les composantes matérielles utiles (processeur, carte graphique, mémoire, écran, polices installées) en plus du rendu canvas et audio, des paramètres WebGL, des langues et de la plateforme. Le cookie d'appareil reste un second signal.
- Même règle qu'avant : empreinte connue depuis la même IP → refusé ; depuis une autre IP → SMS. `HWID_STRICT` devient `FINGERPRINT_STRICT`.


### 2026-10-02 — Inscription protégée contre les robots et les doubles comptes

**Robots**
- **Captcha invisible Cloudflare Turnstile** : rien à faire pour un humain, une case n'apparaît qu'en cas de doute. Jeton vérifié par le serveur.
- **Pot de miel** : champ caché hors écran ; rempli → inscription refusée.
- **Débit** : 3 tentatives d'inscription par minute et par IP, 10 par sous-réseau (/24 en IPv4, /64 en IPv6), puis **blocage de 15 min**.

**Humains malintentionnés**
- **E-mails jetables** : liste à jour (paquet `disposable-email-domains-js`, 8 883 domaines) + liste communautaire téléchargée chaque jour en production + ajouts manuels.
- **Alias interdits** : `moncompte+1@…` = `moncompte@…` (et points ignorés chez Gmail) avant le contrôle d'unicité.
- **Vérification par SMS** : code à 6 chiffres (10 min, 5 essais), **un numéro = un compte**, numéros virtuels (VoIP), surtaxés et fixes refusés (`libphonenumber-js`), pays limités aux pays de lancement, 3 SMS par numéro et 5 par IP et par heure (contre la fraude aux SMS). Mode `SMS_MODE` : `risky` (par défaut : seulement si VPN ou appareil déjà vu ailleurs), `always` ou `off`. Envoi par Twilio en production ; en développement, le code s'affiche dans le journal du serveur.

**Analyse technique**
- **Empreinte d'appareil** : le HWID gagne la détection des polices installées ; nouvelle **empreinte du navigateur** (rendu canvas et audio, paramètres WebGL, langues, plateforme, mémoire). Même HWID ou même empreinte depuis la même IP → refusé ; depuis une autre IP → SMS.
- **VPN et proxys** détectés avec proxycheck.io (cache 1 h) → SMS demandé ; si les SMS sont désactivés, inscription refusée.

**Config de production** : `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (obligatoires), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (obligatoires si `SMS_MODE` n'est pas `off`), `PROXYCHECK_KEY` (facultative : 100 vérifications par jour sans clé).

**Tests** : 47 serveur (dont 24 anti-abus), **20 E2E** (dont l'inscription avec SMS sur smartphone et sur PC).


### 2026-10-02 — Plus de condition d'âge, anti-double compte par HWID

- **Plus aucune condition d'âge** : la case « 21 ans ou plus » est retirée, ainsi que la colonne `age_confirmed_at` (migration `003`). À la place viendront un **système de signalement** et un **interrupteur « contenu sensible »**.
- **Anti-double compte**, revu :
  - **un compte par appareil via le HWID** : le navigateur calcule une empreinte matérielle (`apps/web/src/lib/hwid.ts` : carte graphique, cœurs, écran, tactile, fuseau horaire), envoyée à l'inscription et à la connexion. Elle survit à l'effacement des cookies et à la navigation privée. Le cookie d'appareil reste un second signal ;
  - un HWID déjà connu **bloque l'inscription depuis la même IP**. Depuis une autre IP, l'inscription passe mais les comptes sont **liés** : deux téléphones du même modèle ont souvent le même HWID. `HWID_STRICT=true` bloque partout ;
  - e-mails jetables refusés ;
  - appareils (HWID et cookie) et IP stockés uniquement en **empreinte salée** ;
  - comptes partageant un appareil ou une IP **signalés** (`account_flags`, `linkedAccounts()`) pour bloquer les échanges entre eux.
- Retirés : l'e-mail canonique (alias Gmail) et le plafond de comptes par IP.
- **Tests** : 30 serveur (dont 7 anti-abus : HWID, cookie, téléphones du même modèle, mode strict, plusieurs appareils sur un même réseau, empreintes), 18 E2E (dont un compte refusé dans un navigateur vierge sur le même appareil).


### 2026-10-02 — Comptes sans date de naissance, anti-double compte, collection par boosters

**Comptes**
- Plus de date de naissance : une case **« J'ai 21 ans ou plus »** obligatoire, horodatée en base.
- **Anti-double compte** (`apps/server/src/auth/antiabuse.ts`) :
  - e-mail canonique (points Gmail et `+tag` ignorés) : `jean.dupont+x@gmail.com` = `jeandupont@gmail.com` ;
  - cookie d'appareil httpOnly (2 ans) : **un seul compte par appareil** ;
  - **3 comptes au plus par IP sur 30 jours** (config). L'en-tête `X-Forwarded-For` n'est lu que si `TRUST_PROXY` est activé ;
  - domaines d'e-mail jetables refusés ;
  - appareils et IP stockés uniquement en **empreinte salée** (`SIGNAL_SALT`, obligatoire en production) ;
  - comptes partageant un appareil ou une IP signalés dans `account_flags`, avec `linkedAccounts()` prêt pour bloquer les échanges entre comptes liés.

**Plus de cadeau à l'inscription : la collection se construit en ouvrant des boosters**
- Nouveau compte : 0 carte, **6 boosters gratuits** (contenu aléatoire, autorisé car gratuit) et le choix **d'un Leader de départ** parmi les 5 (une seule fois). Les autres Leaders se trouvent dans les boosters.
- **Pièces** gagnées en ligne : victoire 40, défaite 15, nul 20, 400 par jour au maximum. Affichées sur l'écran de fin.
- **Booster de base avec aperçu** : 5 cartes exactes verrouillées en base, achat à 100 pièces (refusé si l'aperçu a changé), nouvel aperçu après achat ou toutes les 24 h. **Aucun renouvellement payant.** Probabilités affichées.
- **Recyclage** des exemplaires au-delà de 2 en essence, **crafting** jusqu'à 2 exemplaires.
- Toute variation de monnaie est tracée (`coin_ledger`), chaque ouverture aussi, avec sa seed (`booster_openings`).
- Valeurs dans `DEFAULT_ECONOMY` (`apps/server/src/config.ts`).
- L'entraînement hors ligne garde ses 5 decks préconstruits.

**Site**
- Page **Collection** : portefeuille, choix du Leader de départ, aperçu du booster et minuteur, ouverture animée, collection filtrable (cartes non possédées grisées), fiche avec recyclage et crafting.
- Page **Decks** : éditeur (Leader possédé, cartes compatibles possédées, compteur 20/20, complétion automatique).
- Le salon en ligne renvoie vers Collection et Decks tant que le joueur n'a pas de deck.

**Tests** : 70 moteur, 6 contenu, **30 serveur** (dont anti-abus et économie) et **18 E2E** sur smartphone et PC.


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
- **Signalement** et **interrupteur « contenu sensible »** : à placer en phase 4 (avec l'outil d'admin et le marquage des cartes) ?
- Anti-double compte : garder le mode souple (empreinte + même IP, SMS ailleurs) ou passer en strict (`FINGERPRINT_STRICT=true`) ? SMS seulement en cas de risque (`risky`) ou pour tout le monde (`always`, environ 0,07 € par inscription) ?
- Créer les comptes Cloudflare Turnstile, Twilio et proxycheck.io avant la mise en ligne.
- Politique de confidentialité : mentionner l'empreinte d'appareil et la vérification d'IP (intérêt légitime, lutte contre la fraude).
- Réglages de l'économie (6 boosters de bienvenue, 100 pièces le booster, gains par partie) à confirmer après de vraies parties.
