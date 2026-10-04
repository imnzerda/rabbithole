# Avancement

## Phase en cours

**Phase 6 — Rétention** : en cours (phase 5 validée le 2026-10-03). Fait : missions, pass saisonnier, classé. **Phase 5 — Économie** : validée. Fait : trade-up, amis et échanges, gemmes et paiement sandbox, pièces et essence fusionnées, compensation des cartes retirées.

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée |
| 2. Prototype jouable local | ✅ Validée (fusionnée dans `master`) |
| 2 bis. Refonte du duel (One Piece) | ✅ Validée (fusionnée dans `master`) |
| 3. Serveur et comptes | ✅ Validée (fusionnée dans `master`) |
| 4. Pipeline de contenu et admin | ✅ Validée (2026-10-03) |
| 5. Économie | ✅ Validée (2026-10-03) |
| 6. Rétention | 🟡 En cours |
| 7. Social | — |
| 8. International et lancement | — |

**Lancer le jeu :** `pnpm install` puis `pnpm dev` : serveur de jeu (port 3000), site (http://localhost:5173) et outil d'admin (http://localhost:5174). `pnpm dev:lan` rend le site accessible depuis un téléphone du même Wi-Fi. Aucune base à installer : en développement, PostgreSQL tourne en embarqué (PGlite, données dans `apps/server/.data/`). Les réglages locaux (dont `ADMIN_EMAILS=neil.zerda@gmail.com`) sont dans `apps/server/.env`, non versionné. `?timer=0` dans l'URL d'entraînement désactive les minuteurs.

**Dépôt GitHub :** https://github.com/imnzerda/rabbithole (branche `master`).

## Journal

### 2026-10-03 — Phase 6, étape 3 : classé

- **Saisons mensuelles** (mois UTC, clé `AAAA-MM`). **Rangs** : Lurker (0), Normie (100), Posteur (300), Influenceur (600), Viral (1 000), Légende (1 500).
- **Points de classement** : victoire +25, défaite −15, nul +5, multipliés par l'**enjeu de la partie** (Hype ×1, ×2, ×4, cahier des charges section 3.4). Lâcher fait perdre l'enjeu en cours. Une défaite ne fait jamais redescendre sous le seuil du rang atteint. Les parties classées contre un fantôme (quand l'attente dépasse le délai) comptent aussi.
- **Reset partiel** : une nouvelle saison repart avec la moitié des points de la précédente. **Récompense de fin de saison** selon le meilleur rang atteint : des pièces (de 100 à 2 000), plus un titre pour Viral et Légende, versées automatiquement à la première visite de la saison suivante avec une notification.
- **Classements** : top 1 000 mondial et par pays (`/api/ranked/leaderboard?country=…`), avec la position du joueur. Seuls les joueurs ayant joué en classé y figurent.
- **Fin de partie** : `match_end` porte l'évolution des points (`ranked`). L'écran de fin affiche « +25 points de classement · enjeu ×2 » et le nouveau rang. L'ancienne ligne « points de rang », calculée sur la mise de toute partie, ne s'affiche plus qu'en classé, avec les vrais points.
- **Interface** : page **Classement** (rang, progression, bilan, positions, échelle des rangs, classement mondial ou du pays), rang affiché sur le bouton de la file classée, notification de fin de saison.
- **Base** : migration 019 (`ranked`). Toutes les valeurs sont dans la config (`DEFAULT_RANKED`).
- **Tests** : 5 tests serveur (saisons, rangs, Hype, protection de rang, reset partiel, récompense unique, partie classée entre deux joueurs, classements) et 1 scénario E2E. Les tests serveur ont un délai de démarrage plus long (`hookTimeout`), car 15 fichiers démarrent chacun leur base en parallèle.
- **À noter** : l'interface ne propose « Lâcher » que pendant les décisions du joueur, pas pendant le tour adverse, alors que le cahier des charges dit « à tout moment ». À trancher.

### 2026-10-03 — Phase 6, étape 2 : pass saisonnier et premiers cosmétiques

- **Décisions** :
  - les pistes payantes donnent des cosmétiques et des boosters ;
  - le pass s'achète directement en argent réel (premium 9,99 €, deluxe 14,99 €, passage de premium à deluxe 5 €), pas en gemmes : les gemmes serviront à d'autres achats.
  - Les boosters des pistes payantes sont des **boosters à aperçu** (contenu exact affiché avant ouverture), conformément à la règle « pas de booster à contenu caché en vente ». Un test le vérifie.
- **Saisons** de 28 jours (depuis le 2026-10-01), **30 niveaux** de 1 000 points. Points gagnés en partie en ligne (120 / 60 / 80 pour victoire, défaite, nul) et en réclamant les missions. Tout est dans la config (`DEFAULT_PASS`).
- **Pistes** :
  - **gratuite** : 30 pièces par niveau, un booster gratuit (aléatoire) tous les 5 niveaux ;
  - **premium** : titre de saison, variantes holo, dorée et pixel, booster à aperçu tous les 3 niveaux ;
  - **deluxe** (inclut premium) : variantes exclusives glitch, négatif et VHS, titre de légende au niveau 30, boosters à aperçu en plus.
  - Les récompenses de chaque saison sont générées à partir du catalogue, puis figées en base (`pass_seasons`).
- **Achat** : produits `pass_premium`, `pass_deluxe` et `pass_upgrade`, avec prix régionaux, achetés par le même circuit que les gemmes (webhook vérifié). Le passage en caisse vérifie quel achat est permis. Un remboursement recalcule la piste à partir des achats encore valables.
- **Cosmétiques** : six variantes de cartes (holo, doré, glitch, négatif, VHS, pixel) et des titres. Les variantes sont visibles dans la Collection (choix de l'apparence dans la fiche de la carte), sur la page Pass et **en partie** (rendu PixiJS, effets limités à la carte). L'adversaire voit tes variantes et ton titre, transmis dans `match_start` ; un fantôme montre ceux du joueur dont il joue le deck.
- **Boosters à aperçu offerts** : compteur 📦 dans le portefeuille, et bouton « Ouvrir avec un booster offert » dans la Collection, qui ouvre exactement l'aperçu affiché.
- **Base** : migration 018 (`user_pass`, `pass_seasons`, `user_titles`, `user_card_variants`, `users.active_title`, `wallets.preview_boosters`, produits du pass). **API** : `/api/pass`, `/api/pass/claim`, `/api/boosters/:type/redeem`, `/api/cosmetics` (+ `/variant`, `/title`). Routes de test `/api/test/pass-xp` et `/api/test/variant`, interdites en production.
- **Tests** : 7 tests serveur sur le pass (saisons, contenu des pistes, verrous, achat direct, passage au deluxe, boosters à aperçu, cosmétiques, remboursement, points, `match_start`) et 1 scénario E2E (achat du premium, récompenses, booster offert ouvert) sur smartphone et PC.
- **E2E** : la limite d'authentification du serveur de test passe à 1 000 par minute (`AUTH_RATE_LIMIT`), car la suite dépassait 20 inscriptions par minute. Le test d'animation « glisser une carte » reste instable sous la charge de la suite complète (il passe seul).

### 2026-10-03 — Phase 6, étape 1 : missions quotidiennes et hebdomadaires

- **Plan de la phase 6** : 1. missions, 2. pass saisonnier (premier usage des gemmes), 3. classé et saisons, 4. succès, titres et progression de collection, 5. défi du jour et Tendance du jour, 6. draft, tournois, partage de fin de partie.
- **Missions** (cahier des charges, section 13) : **3 par jour et 3 par semaine** pour chaque joueur, tirées par le serveur (RNG `crypto`, seed enregistrée) parmi les modèles de la config (`DEFAULT_MISSIONS` : objectif, pièces, points de pass). Une mission « catégorie » tire aussi sa catégorie. Les missions se renouvellent à minuit UTC, et le lundi pour la semaine.
- **Types de missions** : jouer ou gagner des parties en ligne (y compris contre un fantôme), jouer des cartes ou des cartes d'une catégorie, ouvrir des boosters, faire un trade-up, terminer un échange, fabriquer une carte.
- **Progression** comptée côté serveur : en fin de partie (cartes jouées relues dans les actions de la partie), à l'achat ou l'ouverture d'un booster, au trade-up, à la fabrication, et à l'échange accepté (pour les deux joueurs). Une erreur de mission ne fait jamais échouer l'action du joueur.
- **Récompense** : pièces créditées une seule fois en réclamant la mission (journal `mission`). Les points de pass sont déjà enregistrés, pour le pass à venir.
- **Base** : migration 017 (`user_missions`). **API** : `GET /api/missions`, `POST /api/missions/:id/claim`.
- **Interface** : page **Missions** (lien sur l'accueil), avec les missions du jour et de la semaine, barres de progression, délai avant renouvellement et bouton « Réclamer ». Les textes ont un vrai singulier et un vrai pluriel.
- **Tests** : 5 tests serveur (périodes, tirage, progression, filtre de catégorie, réclamation unique, fin de partie en ligne) et 1 scénario E2E sur smartphone et PC.

### 2026-10-03 — Trade-up : le joueur choisit ses doublons

- Dans la rubrique Trade-up, la section « Tu donnes » affiche tous les doublons de la rareté choisie. Un toucher ajoute un exemplaire, et un toucher de plus au maximum le retire. Le compteur « 3 / 5 » passe au vert au bon nombre (rouge au-delà), et le bouton d'échange ne s'active qu'au nombre exact.
- Le bouton « Échanger » apparaît en haut et en bas de la sélection. Celui du haut est masqué tant qu'il n'y a pas assez de doublons.
- Deux aides : « Compléter » (ajoute les doublons manquants, les plus nombreux d'abord) et « Vider ». La sélection repart de zéro à chaque changement de rareté et après chaque trade-up.
- Le serveur vérifie toujours tout : doublons au-delà des exemplaires jouables, même rareté, nombre exact.

### 2026-10-03 — Rubrique « Trade-up » à part

- Le trade-up quitte la page Collection pour sa propre rubrique (`/trade-up`), avec un lien sur l'accueil et depuis la Collection. La page suit l'ordre du choix : 1. rareté à échanger, 2. tirage (au hasard, ou catégorie au choix), puis les cartes possibles avec leur probabilité, les doublons donnés et le bouton d'échange. La carte obtenue est révélée avec une animation.
- Le scénario E2E passe désormais par le lien de la Collection.

### 2026-10-03 — Phase 5, étape 4 : compensation des cartes retirées

- **Règle** (cahier des charges, section 5) : quand une carte publiée est retirée du jeu, chaque joueur qui la possédait reçoit **son prix de fabrication en pièces, par exemplaire** (par exemple 20 pour une basique, 1 500 pour une GOAT). Les valeurs viennent de la config (`DEFAULT_ECONOMY.craft`).
- **Une seule fonction**, `retireCard` (`apps/server/src/economy/compensation.ts`), sert les trois chemins de retrait : statut « retirée » dans l'admin, bouton « Supprimer » sur une carte déjà publiée, demande de retrait acceptée avec « retirer la carte ». Dans la même transaction, elle :
  - crédite les pièces (journal `card_retired`) ;
  - retire la carte des collections et des decks ;
  - annule les échanges en attente qui la contiennent ;
  - envoie une **notification** au joueur.
- **Notifications** (migration 016, table `notices`) : `GET /api/notices`, `POST /api/notices/read`. Sur l'accueil, elles s'affichent ainsi : « « Nom » a été retirée du jeu : tu as reçu 40 🪙 pour 2 exemplaire(s). », avec un bouton OK.
- **Bogue corrigé** : les cartes publiées d'office au premier démarrage (prototype) n'étaient pas marquées « déjà publiées ». « Supprimer » les aurait effacées malgré leurs détenteurs. Elles sont maintenant marquées, les données existantes sont corrigées par la migration, et une carte publiée n'est jamais effacée.
- **Tests** : 2 tests serveur (les trois chemins, collections, decks, échanges, notifications, journal) et le scénario E2E de l'admin étendu (retrait d'une carte publiée, notification côté joueur).

### 2026-10-03 — Boutique quotidienne abandonnée

- **Décision** : pas de boutique quotidienne. Les gemmes serviront aux cosmétiques et au pass (phase 6). Le texte de la Boutique est corrigé en conséquence.

### 2026-10-03 — Pièces et essence fusionnées

- **Décision** : une seule monnaie gagnée en jeu, les **pièces**. Elles viennent des parties et du recyclage des doublons, et servent aux boosters et au crafting. L'essence existante est convertie en pièces à 1 pour 1 (migration 015).
- **Équilibrage** : avec les anciennes valeurs, recycler un booster rapportait en moyenne environ 104, plus que son prix de 100 pièces, ce qui aurait donné des pièces infinies. Le recyclage passe à **1 / 3 / 10 / 30 / 100** (basique → GOAT), soit environ 25 pièces par booster recyclé. Le crafting ne change pas (20 / 50 / 150 / 500 / 1 500). Un test vérifie qu'un booster recyclé rapporte moins de la moitié de son prix.
- **Correction** : la colonne `gems` interdisait un solde négatif, donc un remboursement après dépense des gemmes aurait fait échouer le webhook. La contrainte est levée (les achats en gemmes exigent toujours un solde suffisant) et le cas est testé.
- **Interface** : le compteur ✨ disparaît, et le recyclage et la fabrication s'affichent en 🪙.

### 2026-10-03 — Phase 5, étape 3 : gemmes et paiement en sandbox

- **Produits** (migration 014) : 6 packs de gemmes (80, 170, 450, 950, 2 000, 5 200), de 0,99 € à 49,99 €. Les prix régionaux couvrent les pays de lancement (USD, CAD, GBP, CHF, PLN, BRL, MXN, JPY, PHP), en unité mineure de la devise ; le pays « * » donne le prix par défaut en euros. Les prix vivent en base, pas dans le code.
- **`PaymentProvider`** (`apps/server/src/payments/provider.ts`) : `createCheckout`, `verifyWebhook`, `refund`. Le prestataire **sandbox** (`PAYMENT_PROVIDER=sandbox`, par défaut en dev et en test) a une page de paiement factice (`/shop/sandbox`). « Payer » lui fait envoyer au serveur un **webhook signé HMAC**, par la même route qu'un vrai prestataire (`/api/webhooks/payment/:provider`, corps brut vérifié). Le sandbox est **interdit en production**, où la boutique reste fermée tant qu'aucun prestataire réel n'est branché.
- **Crédit** : le passage en caisse crée une transaction `pending`, et seul un webhook vérifié la complète et crédite les gemmes. Un événement rejoué n'a aucun effet (`payment_events`), et une transaction n'est créditée qu'une fois (`provider_transaction_id` unique, statut `pending` exigé). Un montant ou une devise incohérents ne sont pas crédités (statut `mismatch`, inscrit au journal d'audit). Un remboursement ou une rétrofacturation retirent les gemmes (le solde peut devenir négatif) ; une rétrofacturation est inscrite au journal d'audit. Aucune route ne permet au client de se créditer.
- **Transparence** : historique d'achats, et **plafond de dépense mensuel** facultatif dans la devise du joueur (les paiements en attente comptent, un paiement abandonné ne compte plus).
- **Interface** : page **Boutique** (`/shop`, lien sur l'accueil), avec les packs au prix du pays, le plafond et l'historique. Les gemmes s'affichent aussi dans la Collection.
- **Tests** : 7 tests serveur (prix régionaux, crédit par webhook seulement, signature, rejeu, montant incohérent, remboursement, rétrofacturation, plafond, abandon, sandbox interdit en production, boutique fermée) et 1 scénario E2E (achat, retour, annulation) sur smartphone et PC.
- **À choisir avant la mise en ligne** : le prestataire réel (classique, ou spécialisé si le contenu adulte fait classer le site, section 14). Il suffira d'écrire sa classe `PaymentProvider`.

### 2026-10-03 — Rubrique « Échanges » à part

- La page « Amis et échanges » est découpée en deux rubriques, chacune avec son lien sur l'accueil.
  - **Amis** (`/friends`) : code ami, ajout, demandes, liste des amis. Un lien vers les Échanges indique le nombre de propositions reçues.
  - **Échanges** (`/trades`) : propositions reçues, nouvel échange (choix d'un ami), propositions envoyées, historique.
- Depuis un ami, « Proposer un échange » ouvre directement la proposition dans la rubrique Échanges (`/trades?with=…`).

### 2026-10-03 — Échanges libres entre amis

- **Décision** : plus de limites dans les échanges. On peut mettre plusieurs cartes de chaque côté, de raretés libres, ou faire un don (un côté vide, ou une demande de don). Il n'y a plus de limite par jour ni de limite pour les GOAT, et les comptes liés peuvent échanger (ils restent signalés pour revue).
- **Ce qui reste vérifié** : être amis, posséder les cartes, et que les cartes soient autorisées dans les deux pays. Tout est revérifié à l'acceptation, puis les cartes changent de main d'un coup. Une proposition expire après 72 h, et un joueur ne peut pas avoir plus de 20 propositions en attente (anti-spam).
- **Decks** : une carte donnée quitte les decks de son ancien propriétaire, qui gardent seulement les exemplaires encore possédés. Un Leader donné reste en tête du deck, qui demande alors un autre Leader.
- **Base** : migration 013 (table `trade_items`, colonnes de carte unique supprimées de `trades`). La config ne garde que `trades.expiryHours`. La route de test `/api/test/unlink` a été retirée.
- **Interface** : dans la fenêtre de proposition, chaque toucher sur une carte ajoute un exemplaire, et un toucher de plus au maximum la retire. Une recherche par nom et un résumé (« Tu donnes 3 carte(s), tu reçois 1 carte(s). ») complètent la fenêtre. Les échanges affichent toutes les cartes de chaque côté, ou « Rien » pour un don.
- **Tests** : 9 tests serveur sur les échanges (plusieurs cartes, dons, sans limite, comptes liés, refus, expiration, decks) et le scénario E2E adapté, sur smartphone et PC.

### 2026-10-03 — Phase 5, étape 2 : amis et échanges

- **Amis** : chaque joueur a un **code ami** unique de 8 caractères, puisque les pseudos ne sont pas uniques. On ajoute quelqu'un par son code, ou par pseudo s'il est unique. Deux demandes croisées valent acceptation. On peut refuser, annuler ou retirer un ami ; retirer un ami annule les échanges en attente entre vous. Il n'y a **pas de délai** avant de pouvoir échanger (décision du 2026-10-03).
- **Échanges** (cahier des charges, section 6.5) : 1 carte contre 1, de même rareté, sans aucune monnaie. On propose une carte d'un ami et une des siennes ; rien ne bouge avant l'acceptation. À l'acceptation, tout est revérifié (amitié, comptes liés, possession, limites, cartes autorisées dans les deux pays), puis les deux cartes changent de main d'un coup. Une proposition expire au bout de 72 h. Les limites (5 échanges par jour, 1 échange de GOAT par semaine) sont dans la config (`DEFAULT_ECONOMY.trades`). Les comptes liés (même appareil ou même réseau) ne peuvent pas échanger entre eux. Les mouvements de cartes sont inscrits au journal (`coin_ledger`, motif `trade`).
- **Base** : migration 012 (`users.friend_code`, tables `friendships` et `trades`). **API** : `/api/friends` et `/api/trades`. **Module** : `apps/server/src/social/`.
- **Interface** : page « Amis et échanges » (`/friends`, lien « Amis » sur l'accueil). On y trouve son code ami à copier, l'ajout d'un ami, les demandes, la liste des amis, les échanges reçus (« Tu reçois » ⇄ « Tu donnes ») et envoyés, et l'historique. La proposition se fait en deux étapes : une carte de l'ami, puis une des siennes de même rareté.
- **Tests** : 8 tests serveur (amis, échanges, refus, expiration, limites, GOAT, comptes liés) et 1 scénario E2E à deux navigateurs, sur smartphone et PC. Route de test `/api/test/unlink`, interdite en production : en test, tous les navigateurs viennent de la même adresse.
- **À savoir** : en dev, deux comptes sur le même ordinateur ne peuvent pas échanger (même réseau, donc comptes liés). Et l'empreinte d'appareil empêche de toute façon d'en créer deux sur la même machine. Pour tester à la main, il faut un deuxième appareil sur un autre réseau, ou passer par les tests.
- **Reste** : le tableau d'échanges de guilde (avec les guildes, phase 7).

### 2026-10-03 — Phase 5, étape 1 : trade-up

- **Règles** (cahier des charges, section 6.4) : 5 doublons de même rareté donnent 1 carte de la rareté supérieure ; 8 doublons permettent de choisir la catégorie. On ne donne que des doublons, au-delà des exemplaires jouables (`keepCopies`, 1 pour un Leader). Rien au-dessus de GOAT. Les nombres sont dans la config (`DEFAULT_ECONOMY.tradeUp`).
- **Tirage** : uniquement côté serveur (`crypto`), parmi les cartes de la rareté supérieure (et de la catégorie choisie) que le joueur ne possède pas encore ; s'il les a toutes, parmi toutes. Les cartes sont équiprobables.
- **Audit** : table `trade_ups` (migration 011) avec les doublons donnés, les cartes possibles et la seed. Chaque tirage peut être rejoué. Aucune monnaie n'est en jeu.
- **API** : `GET /api/trade-up?rarity=…&category=…` (offre et probabilités, avant tout échange) et `POST /api/trade-up`.
- **Interface** (page Collection) : panneau « Trade-up » avec la rareté et le nombre de doublons, le mode (au hasard ou catégorie au choix), la probabilité et la liste des cartes possibles, et les doublons donnés, choisis automatiquement et affichés (`apps/web/src/lib/tradeup.ts`). La carte obtenue s'affiche comme une ouverture de booster.
- **Tests** : 4 tests serveur (offre, échange, préférence pour les cartes non possédées, refus, trade-up ciblé) et 1 scénario E2E sur smartphone et PC. Route de test `/api/test/set-card`, interdite en production comme `grant-kit`.

### 2026-10-03 — Phase 4 validée

- Pipeline de contenu, outil d'administration et set de base (250 cartes, 15 Leaders, 15 decks de référence) validés.
- Restent pour plus tard, hors phase 4 : les illustrations sur les cartes en jeu (Cloudflare R2), d'autres Leaders pour couvrir plus de paires de catégories, et une courbe de coût plus légère.

### 2026-10-03 — Décisions : marques, règles par pays, seuils de Crimes et Mystères

- **Marques** (Wikipédia, YouTube, Minecraft…) : autorisées comme cartes, y compris en production (cahier des charges, section 5).
- **Règles par pays** : le mécanisme est en place (admin, filtrage), mais leur contenu est reporté à plus tard.
- **Seuils de notoriété par catégorie** (`CATEGORY_RULES` dans `tools/pipeline/src/config.ts`) : dans le set de base, Crimes et Mystères passent à **20 langues et score ≥ 50**, au lieu de 40 langues et 90. Les autres catégories ne changent pas. Le plancher de langues vaut aussi pour l'extraction Wikidata.
- **Extractions fusionnées** : `pipeline extract --categories …` (et `all`) complète le fichier de candidats au lieu de l'écraser, et garde les ajouts manuels. Les vues et les vérifications d'images déjà faites sont reprises.
- Nouvelle extraction de Crimes et Mystères : 147 nouveaux candidats (3 889 au total). Les sujets utilisables passent de 4 à **64** en Crimes et de 5 à **52** en Mystères. Ils sont importés dans l'admin de dev, prêts pour les prochaines séries.

### 2026-10-03 — Set de base complet : 250 cartes + 15 Leaders

- **Décision** : les Leaders ne comptent pas dans les 250 cartes du set de base, ni dans les raretés (cahier des charges, section 4.1). On peut ainsi ajouter des Leaders pour de nouvelles paires de catégories sans retirer de cartes.
- **Lot 6** (`tools/pipeline/drafts/base_01_lot6.json`) : une carte de plus par catégorie, pour arriver à 24 partout. Ce sont 9 iconiques (Angelina Jolie, Godzilla, Charles III, Ronaldo, Paul McCartney, Marlon Brando, Shigeru Miyamoto, Copernic, Amelia Earhart) et une virale (l'attaque du train postal de 1963).
- **Le set colle maintenant au cahier des charges** : 24 cartes par catégorie, 10 Légendes, 110 basiques, 70 tendance, 45 virales, 18 iconiques, 7 GOAT. Les coûts se répartissent ainsi : 1 : 32, 2 : 55, 3 : 55, 4 : 47, 5 : 37, 6 : 17, 7 : 7. C'est plus lourd que la courbe prévue (section 4.3 : 20 % de coûts 1, on en a 13 %).
- Les decks de référence ne changent pas (41–62 %).
- Base de dev : 265 cartes publiées dans `base_01` (250 cartes et 15 Leaders).

### 2026-10-03 — 5 Leaders de plus (15), decks avec les cartes du lot 4

- **5 Leaders** (`tools/pipeline/drafts/base_01_lot5.json`), chacun sur une paire de catégories encore sans Leader ; chaque catégorie apparaît une fois :
  - Mark Zuckerberg (Science + Internet) : défausse adverse à chaque attaque, 4 Vies ;
  - Giacomo Casanova (Nuits + Crimes) : 1 Buzz pour épuiser un adversaire de coût 3 ou moins ;
  - Indiana Jones (Exploration + Mystères) : pioche ou Buzz au hasard à chaque attaque ;
  - Jean-Claude Van Damme (Sport + Cinéma) : sportifs +1 pendant son tour ;
  - John Lennon (Musique + Guerre) : alliés +1 pendant son tour, 4 Vies.
- **5 decks de référence**, surtout avec des cartes du lot 4 (15 decks au total). Équilibre : **41 % à 62 %**.
- **Leçon de l'équilibrage** : avec 20 cartes, une pioche de plus par tour vide le deck vers le 11e tour. Le premier deck Zuckerberg (Leader qui pioche, Larry Page, Hawking, Markiplier…) perdait 8 parties sur 10 par pioche vide (2 % de victoires). Il faut éviter d'empiler les effets de pioche, et les capacités de Leader répétables qui piochent.
- Sujets ajoutés au pipeline : Indiana Jones, Casanova, Van Damme, Amelia Earhart (gardée pour une prochaine série).
- Base de dev : **255 cartes** publiées dans `base_01` (240 cartes et 15 Leaders), 15 decks de référence.

### 2026-10-03 — Set de base complet : lot 4 (250 cartes)

- **110 cartes** (`tools/pipeline/drafts/base_01_lot4.json`), 10 par catégorie et 10 Légendes. Sujets ajoutés au pipeline avec `pipeline add` : Kate Moss, Coco Chanel, Moulin-Rouge, Oktoberfest, Woodstock, carnaval de Rio, Las Vegas Strip, Ibiza ; Jesse James, Butch Cassidy, Madoff, Enron, Dieselgate ; Atlantide, Eldorado, kraken, Mary Celeste, suaire de Turin, Anticythère, lumières de Phoenix, diable de Jersey, Khéops ; Élisabeth II, Charlemagne, Jeanne d'Arc, Gengis Khan, chute du mur de Berlin ; Tiger Woods, Simone Biles ; Ed Sheeran, Beethoven ; Hawking, Freud ; Leeroy Jenkins, All your base, Lolcat, Keyboard Cat, Numa Numa, rage comics, Ninja, Squeezie, KSI ; Jules Verne, Agatha Christie, Marie-Antoinette.
- **Légendes** (deux catégories chacune) : GOAT : Michael Jackson, Cristiano Ronaldo, Agatha Christie, Jules Verne, Alfred Hitchcock ; virales : Maradona, Tupac, Marie-Antoinette, Stephen King, Jimi Hendrix.
- Raretés du lot : 64 basiques, 30 tendance, 11 virales, 5 GOAT, surtout des coûts 1 à 3. Toutes les cartes sont dans le budget (test des brouillons).
- Les decks de référence ne changent pas. L'équilibre reste à 40–59 %.
- Base de dev : **250 cartes** publiées dans `base_01` (240 cartes et 10 Leaders). Six cartes sans image libre restent typographiques : Dieselgate, Enron, chemtrails, Keyboard Cat, de Gaulle et Élisabeth II.

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

### Set de base (suite)
- Les **250 cartes** sont là (6 lots, Leaders comptés à part) et 15 Leaders couvrent 10 paires de catégories sur 45. Reste à faire : d'autres Leaders, pour que plus de paires forment un deck jouable (section 4.3).
- **Illustrations** sur les cartes en jeu : recadrage, teinte par catégorie, stockage Cloudflare R2 (section 10.3). Pour l'instant, les cartes restent typographiques en jeu ; la photo n'apparaît que sur la fiche.

### Phase 5 — Économie (suite)
Déjà fait : pièces, aperçus de boosters, boosters gratuits, recyclage, crafting, trade-up, amis et échanges, gemmes et `PaymentProvider` en sandbox (webhooks idempotents, prix régionaux), compensation des cartes retirées. Reste pour la mise en ligne : brancher le prestataire de paiement réel.

### Questions ouvertes
- Faut-il réintroduire les terrains sous forme de cartes **Lieu** dans une prochaine série ?
- Faut-il affiner l'équilibrage avec de vraies parties (Coups tordus reste un peu au-dessus) ?
- Anti-double compte : garder le mode souple (empreinte + même IP, SMS ailleurs) ou passer en strict (`FINGERPRINT_STRICT=true`) ? SMS seulement en cas de risque (`risky`) ou pour tout le monde (`always`, environ 0,07 € par inscription) ?
- Créer les comptes Cloudflare Turnstile, Twilio et proxycheck.io avant la mise en ligne.
- Choisir le prestataire de paiement réel (classique ou spécialisé : CCBill, Segpay, Verotel) et écrire sa classe `PaymentProvider`.
- Politique de confidentialité : mentionner l'empreinte d'appareil et la vérification d'IP (intérêt légitime, lutte contre la fraude).
- Réglages de l'économie (6 boosters de bienvenue, 100 pièces le booster, gains par partie) à confirmer après de vraies parties.
- Règles par pays (contenu adulte, politique) : reportées, à définir plus tard.
