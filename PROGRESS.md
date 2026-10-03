# Avancement

## Phase en cours

**Phase 4 — Pipeline de contenu et admin** : terminée, en attente de validation (premier lot de 30 cartes réelles à relire et publier dans l'admin).

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée |
| 2. Prototype jouable local | ✅ Validée (fusionnée dans `master`) |
| 2 bis. Refonte du duel (One Piece) | ✅ Validée (fusionnée dans `master`) |
| 3. Serveur et comptes | ✅ Validée (fusionnée dans `master`) |
| 4. Pipeline de contenu et admin | ✅ Terminée, en attente de validation |
| 5. Économie | 🟡 Bases avancées (pièces, aperçus, boosters gratuits, recyclage, crafting) |
| 6. Rétention | — |
| 7. Social | — |
| 8. International et lancement | — |

**Lancer le jeu :** `pnpm install` puis `pnpm dev` : serveur de jeu (port 3000), site (http://localhost:5173) et outil d'admin (http://localhost:5174). `pnpm dev:lan` rend le site accessible depuis un téléphone du même Wi-Fi. Aucune base à installer : en développement, PostgreSQL tourne en embarqué (PGlite, données dans `apps/server/.data/`). Les réglages locaux (dont `ADMIN_EMAILS=neil.zerda@gmail.com`) sont dans `apps/server/.env`, non versionné. `?timer=0` dans l'URL d'entraînement désactive les minuteurs.

**Dépôt GitHub :** https://github.com/imnzerda/rabbithole (branche `master`).

## Journal

### 2026-10-03 — Set de base : lot 3 (140 cartes, 10 Leaders, 10 decks)

- **5 nouveaux Leaders** (un deuxième par paire) : Billie Eilish (Internet + Musique), Pelé (Guerre + Sport), Harry Houdini (Crimes + Mystères), Carl Sagan (Science + Exploration), Paris Hilton (Séries + Nuits).
- **50 cartes** (`tools/pipeline/drafts/base_01_lot3.json`) : Whitney Houston, Monica Bellucci, Gal Gadot, Selena Gomez, Cameron Diaz ; Mary Read, Francis Drake, Henry Morgan, Barberousse, l'affaire Iran-Contra ; moaïs, Nazca, Roswell, Mothman ; Reagan, Obama, Jean-Paul II, Nixon, Terechkova ; Neymar, Djokovic, Ronaldinho, Hamilton, Kobe Bryant ; Bowie, Rihanna, The Beatles (iconique), Bob Marley, Prince ; Brad Pitt, Bruce Lee, Stallone, Keanu Reeves, Clint Eastwood ; PewDiePie, Harlem Shake, Distracted Boyfriend, Charli D'Amelio, Khaby Lame ; Bill Gates, Linus Torvalds, Wozniak, Alan Turing, Descartes ; Gagarine, Vasco de Gama, Bear Grylls, Tensing Norgay, Ibn Battuta.
- **Équilibre à 10 decks** : premier essai Pelé 81 %, Sagan 7 %, Houdini 31 %. Ajustements : capacités des Leaders Pelé (+1 à l'allié le plus fort), Houdini (alliés +1 pendant le tour adverse), Sagan (alliés +1 pendant son tour) ; Hamilton et Kobe Bryant 6 → 5 ; decks Pelé, Houdini et Sagan retouchés. Résultat : **40 % à 59 %**. Le test d'intégration du serveur importe maintenant tous les lots du dossier.
- Base de dev : 140 cartes publiées dans `base_01` (130 cartes et 10 Leaders), 10 decks de référence. Il reste 110 cartes pour atteindre les 250 du set de base.


### 2026-10-03 — Séries du prototype supprimées

- Commande `pnpm --filter @rabbithole/server content:remove-series` (serveur arrêté, irréversible, pas de bouton dans l'admin) : cartes, images et decks de référence de la série ; les collections perdent ces cartes, les decks de joueurs qui les utilisent sont effacés, les aperçus de boosters régénérés, un Leader de départ disparu peut être choisi de nouveau. Les replays restent lisibles.
- Le prototype n'est plus réimporté au démarrage, sauf sur une base vide (premier lancement, tests).
- Base de dev : séries `prototype` et `prototype_tokens` supprimées (57 cartes, 132 entrées de collection, 10 decks de joueurs) ; le catalogue joué ne contient plus que les 85 cartes de `base_01`. Le contenu du prototype reste embarqué dans le site pour l'entraînement hors ligne (serveur injoignable).


### 2026-10-03 — Set de base importé et publié en dev

- Commande `pnpm --filter @rabbithole/server content:import` (serveur arrêté) : candidats, lots de brouillons, decks de référence, publication, et `--sync` pour aligner les cartes déjà présentes sur les lots. Mêmes fonctions que l'admin, actions notées dans le journal d'audit.
- Base de dev : 85 cartes de `base_01` publiées (dont 5 Leaders), série publiée, 5 decks de référence ; les 4 cartes du lot 1 ajustées pour l'équilibre sont à jour. L'entraînement propose maintenant les decks réels.


### 2026-10-03 — Decks de référence en jeu

- Table `series_decks` (migration `010`) : les decks de référence d'une série (`tools/pipeline/decks/<série>.json`) s'importent dans l'admin (page Séries), validés avec les cartes de la série.
- **Entraînement contre l'IA** (accueil et partie) : decks de la série publiée, avec les cartes réelles telles que le joueur les voit (contenu sensible masqué). Repli sur les decks du prototype embarqués si aucune série n'est publiée ou si le serveur est injoignable.
- **Fantômes de repli** : deck d'un autre joueur d'abord, sinon un deck de référence de la série publiée, sinon un deck du prototype.
- **Admin** : simulations avec les decks de référence de toutes les séries.
- Test d'intégration avec les vrais lots : import des 85 cartes et des 5 decks, publication, decks proposés à l'entraînement, fantôme avec un Leader réel. Tests : 68 serveur, 24 E2E.


### 2026-10-03 — Plus de validation humaine ; suppression manuelle des cartes

- La politique de contenu ne bloque plus la publication, sauf pour un sujet exclu (personne mineure aujourd'hui). Les raisons « à revoir » restent affichées dans l'admin, pour information ; l'étape « Valider la politique de contenu » est supprimée.
- **Supprimer une carte** (éditeur et liste des cartes) : effacée si elle n'a jamais été publiée (son candidat redevient disponible), retirée du jeu sinon. Migration `009` : indicateur « déjà publiée ».
- Tests : 63 serveur → 64 (dont la suppression), 24 E2E (parcours admin avec suppression).


### 2026-10-03 — Exclusions automatiques remplacées par la revue humaine

- Décision : plus d'exclusion automatique pour le terrorisme, les attentats, la négation de la Shoah ; ces sujets passent « à revoir » (note obligatoire pour publier) et sont marqués « sensibles ». Base `base_01` : 0 exclu, 282 à revoir.
- Gardé : une personne **encore mineure aujourd'hui** reste exclue d'office.
- Cahier des charges (section 5), CLAUDE.md et README du pipeline mis à jour. Correctif : raisons en double qui faisaient planter la page Candidats.


### 2026-10-03 — Set de base : Leaders réels, deuxième lot, decks équilibrés

- **`pipeline add`** : ajout manuel de sujets par identifiant Wikidata, avec les mêmes contrôles (notoriété, politique, image). 21 sujets ajoutés : D. B. Cooper, Frank Abagnale, Charles Ponzi, train postal Glasgow-Londres ; triangle des Bermudes, zone 51, Stonehenge, Nazca, moaïs, Sasquatch, Voynich, Mothman, cercles de culture ; Doge, Nyan Cat, Grumpy Cat, Gangnam Style, Harlem Shake, Distracted Boyfriend, Trollface ; Cléopâtre, Studio 54. Pepe the Frog écarté (récupéré comme symbole haineux).
- **5 Leaders réels** (capacités reprises des Leaders du prototype, déjà équilibrées) : Justin Bieber (Internet + Musique), Arnold Schwarzenegger (Guerre + Sport), D. B. Cooper (Crimes + Mystères), Jacques-Yves Cousteau (Science + Exploration), Marilyn Monroe (Séries + Nuits).
- **Lot 2** (`tools/pipeline/drafts/base_01_lot2.json`) : les 5 Leaders et 50 cartes (5 par catégorie), dont Napoléon en GOAT, Elvis, Lady Gaga, Cléopâtre et Steve Jobs en iconiques. Avec le lot 1 : 80 cartes à collectionner et 5 Leaders, soit 8 cartes par catégorie.
- **Équilibre** : 5 decks de référence (`tools/pipeline/decks/base_01.json`), un par Leader. Premier essai très déséquilibré (Cousteau 95 %, Bieber 22 %) ; après ajustements (Zidane 3, Jules César 5, Al Capone met KO la carte adverse la plus forte de coût 4 au plus, loch Ness renvoie jusqu'au coût 4, Leaders Bieber et Cooper à 5 Vies) : **42 % à 57 %** de victoires sur 200 parties par confrontation, comme le prototype. Un test permanent garde chaque deck entre 35 % et 65 %.
- Constat : `add_buzz` (un Buzz de plus pour le reste de la partie) vaut sans doute plus que 1 point dans le budget ; à recalibrer quand il y aura davantage de cartes d'accélération.


### 2026-10-02 — Phase 4, étape 5 : premier lot de cartes réelles

- **Pipeline sur le set de base** : 3 672 candidats, 3 191 avec une image libre ; politique : 9 exclus (terrorisme, négation de la Shoah, mineurs aujourd'hui), 270 à revoir.
- Vues Wikipédia **par lots de 50** sur 60 jours : l'API « par article » (12 mois) refusait les requêtes (HTTP 429). La continuation des lots est suivie (sinon biais alphabétique).
- Politique renforcée : descriptions évoquant le terrorisme ou la négation de la Shoah → exclusion d'office (« terroris… », pas « terror » : en portugais, c'est le film d'horreur).
- **Lot `tools/pipeline/drafts/base_01.json`** : 30 cartes (3 par catégorie, styles de la section 4.1), dont 1 GOAT (Freddie Mercury) et 4 iconiques (Churchill, Madonna, Wikipédia, Einstein). Toutes valides et dans le budget (test automatique), textes FR et EN, images libres créditées. Deux cartes à valider (Al Capone : condamné ; Jules César : mort violente).
- **Import dans l'admin** : Candidats → importer `tools/pipeline/out/base_01.json`, puis Cartes → « Importer des brouillons » `tools/pipeline/drafts/base_01.json` (la série est créée si besoin).
- Reste à faire hors code : relire et publier le lot, publier la série `base_01` ; puis les Leaders réels et le reste des 250 cartes.


### 2026-10-02 — Règle des mineurs simplifiée

- Décision : une carrière commencée avant 18 ans n'exclut plus personne, et il n'y a plus de revue humaine à ce sujet (début de carrière inconnu, enfants acteurs devenus adultes).
- Gardé : une personne **encore mineure aujourd'hui** est exclue d'office (contenu adulte, mécanique de Séduction, ton décalé).
- Cahier des charges (section 5), CLAUDE.md et pipeline mis à jour.


### 2026-10-02 — Phase 4, étape 4 : côté joueur (signalement, contenu sensible, retraits, crédits, pays)

- **Interrupteur « contenu sensible »** (page Réglages) : **masqué par défaut**. Une carte masquée (drapeau `sensitive` ou `adult`) s'affiche « Carte masquée », sans nom ni texte d'ambiance, partout (collection, decks, plateau, replays) ; elle se joue normalement.
- **Signalements** : une carte (depuis sa fiche) ou l'adversaire d'une partie en ligne contre un humain (écran de fin) ; 20 par jour au plus. File de modération dans l'admin (décision obligatoire, nombre de signalements ouverts sur la même cible).
- **Demande de retrait** (section 5) : formulaire public sans compte (lien sur chaque fiche et en bas de l'accueil), **échéance 72 h**, file dans l'admin (en retard signalé), **retrait de la carte en un clic**.
- **Crédits** (section 10.2) : page publique, et ligne de crédit avec la photo sur la fiche de chaque carte illustrée.
- **Règles par pays** (section 9), gérées dans l'admin : contenu adulte, contenu politique, cartes bloquées. Une carte bloquée est absente des boosters (un aperçu qui en contient une est remplacé, jamais vendu), refusée en deck, cachée dans la collection, masquée chez un adversaire d'un autre pays.
- **Tests** : 62 serveur (dont 6 de modération), 24 E2E (réglage, masquage, signalement, demande de retrait, crédits).


### 2026-10-02 — Phase 4, étape 3 : outil d'administration (`apps/admin`)

- **Accès** : rôle `admin` donné aux e-mails de `ADMIN_EMAILS` (aucun autre moyen). L'outil tourne sur http://localhost:5174 (`pnpm dev` lance maintenant serveur, site et admin) et partage la session du site.
- **Candidats** : import du fichier du pipeline, filtres (catégorie, statut, politique, score, nom ou Q-id), retenir / rejeter, **créer la carte** : brouillon prérempli (nom en 5 langues, catégories, pays, drapeaux, rareté « iconique » pour les iconiques, image créditée ou carte typographique). Un sujet exclu ne devient jamais une carte.
- **Éditeur de cartes** : stats, catégories, mots-clés, effets en DSL JSON, textes d'ambiance en 5 langues, drapeaux ; **aperçu en direct** (validation du moteur, budget de puissance détaillé, texte de la carte).
- **Publication** : brouillon → relecture → publiée → retirée. Bloquée tant que la définition est invalide, que la politique de contenu n'a pas été validée (note obligatoire) ou qu'il n'y a ni image créditée ni carte typographique. Publier une carte ou une série met à jour le catalogue joué.
- **Images** : crédit complet, retrait en un clic (la carte passe en typographique).
- **Séries** : création (base, mondiale, pays), publication, dépublication.
- **Équilibrage** : **budget de puissance** (moteur, `cardBudget`, valeurs dans `DEFAULT_BUDGET`) calibré sur le prototype (46 cartes sur 52 dans la norme), et **simulations IA contre IA** (`simulateMatchup`).
- **Journal d'audit** : chaque action d'administration est horodatée.
- **Tests** : 79 moteur (budget, simulations), 56 serveur (dont 6 admin), 21 E2E (dont le parcours admin complet sur PC).


### 2026-10-02 — Phase 4, étape 2 : pipeline de contenu (`tools/pipeline`)

- CLI `pnpm --filter @rabbithole/pipeline pipeline <commande>` : `extract`, `score`, `policy`, `images`, `export`, `validate`, `all` (voir [tools/pipeline/README.md](tools/pipeline/README.md)).
- **Extraction Wikidata** : 55 sources (occupations et natures Wikidata vérifiées via l'API) réparties sur les 10 catégories, classées par nombre de langues, filtre pays facultatif (`--country FR`).
- **Notoriété** : vues Wikipédia sur 12 et 60 mois dans 10 langues ; score rangé **par catégorie** (sinon la musique et le football écrasent tout) ; iconiques = top 1 % du lot.
- **Politique de contenu** automatique : exclus (mineurs, terrorisme), à revoir (victimes, condamnations, morts violentes, Industrie X, mots sensibles, début de carrière inconnu), drapeaux `adult`, `sensitive`, `politicallySensitive`.
- **Images Commons** : licence vérifiée (domaine public, CC0, CC BY, CC BY-SA), crédit complet, droits de la personnalité signalés.
- Résultats dans `tools/pipeline/out/` (JSON de travail + CSV), importés dans l'admin à l'étape 3.
- **Tests** : 19 tests unitaires sans réseau.
- Limites : vues sur 10 langues, début de carrière souvent absent de Wikidata, images pas encore recadrées ni envoyées sur R2.


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

### Clore la phase 4
- Fait en dev : set de base importé et publié. Relire les cartes en jeu et dans l'admin, enlever celles qui ne conviennent pas.

### Set de base (suite)
- Le reste des **250 cartes** (section 4.3 pour la courbe de coût, 4.2 pour les raretés), par lots de brouillons ; davantage de Leaders (plusieurs par paire de catégories).
- **Illustrations** sur les cartes en jeu : recadrage, teinte par catégorie, stockage Cloudflare R2 (section 10.3). Pour l'instant, les cartes restent typographiques en jeu ; la photo n'apparaît que sur la fiche.

### Phase 5 — Économie (suite)
Déjà fait : pièces, essence, aperçus de boosters, boosters gratuits, recyclage, crafting. Reste : trade-up, échanges (avec blocage des comptes liés), boutique quotidienne, gemmes, `PaymentProvider` en sandbox (webhooks idempotents), prix régionaux. À faire aussi : compensation (carte de même rareté ou essence) quand une carte possédée est retirée (section 5).

### Questions ouvertes
- Valider la phase 4.
- Faut-il réintroduire les terrains sous forme de cartes **Lieu** dans une prochaine série ?
- Faut-il affiner l'équilibrage avec de vraies parties (Coups tordus reste un peu au-dessus) ?
- Anti-double compte : garder le mode souple (empreinte + même IP, SMS ailleurs) ou passer en strict (`FINGERPRINT_STRICT=true`) ? SMS seulement en cas de risque (`risky`) ou pour tout le monde (`always`, environ 0,07 € par inscription) ?
- Créer les comptes Cloudflare Turnstile, Twilio et proxycheck.io avant la mise en ligne.
- Politique de confidentialité : mentionner l'empreinte d'appareil et la vérification d'IP (intérêt légitime, lutte contre la fraude).
- Réglages de l'économie (6 boosters de bienvenue, 100 pièces le booster, gains par partie) à confirmer après de vraies parties.
- **Marques** (Wikipédia, YouTube, Minecraft…) : vérification juridique avant d'en faire des cartes publiées.
- **Notoriété** : Crimes et Mystères n'ont qu'un sujet au-dessus du seuil (≥ 40 langues, score ≥ 90). Abaisser leurs seuils, ou curation sous le seuil pour ces deux catégories ?
- Règles par pays (contenu adulte, politique) à valider juridiquement pays par pays.
