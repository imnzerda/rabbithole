# RABBIT HOLE — Cahier des charges

> **Nom du jeu : RABBIT HOLE** — accroche : *Fall into everything.*
> Le nom évoque le fait de se perdre de lien en lien sur internet, comme le joueur passe d'une carte à l'autre. Identité visuelle : un lapin stylisé (mascotte et logo) et un motif de « terrier » / spirale. Ces éléments servent pour le logo, l'écran de chargement, les dos de cartes par défaut et les animations d'ouverture de booster (la carte « tombe » du terrier).
> Note : « Viral » reste le nom d'une rareté et d'un mot-clé de jeu ; ce n'est plus le nom du jeu.

> Document destiné à Claude Code. Il décrit le jeu, les règles, l'économie, le contenu, l'architecture et l'ordre de développement. Développe **phase par phase** (section 17) et demande validation à la fin de chaque phase avant de continuer.

---

## 1. Vision

TCG (jeu de cartes à collectionner) jouable dans le navigateur, desktop et mobile. Les cartes représentent des personnes, événements, lieux et phénomènes réels issus de Wikipédia / Wikidata : de la culture internet à l'histoire, du sport aux scandales, en passant par l'industrie X.

- **Public** : cœur de cible 21–40 ans. Aucune restriction d'âge à l'inscription ; le contenu sensible est masquable par un interrupteur et tout contenu peut être signalé (section 14).
- **International** dès le lancement, avec des séries par pays.
- **Identité** : la culture internet est l'ADN du jeu (mécaniques, raretés, interface, ton).
- **Ton** : ironique, décalé, adulte, mais **aucune image explicite**.
- **Duels tour par tour inspirés du TCG One Piece** (Leader, Vies, attaques, contres), parties de 6 à 10 minutes.
- **Monétisation** : boosters à contenu prévisualisé (aucun hasard à l'achat), pass saisonnier, cosmétiques. Pas de pay-to-win.

---

## 2. Stack technique

| Couche | Choix |
|---|---|
| Rendu du jeu | **PixiJS v8** (plateau, cartes, animations de révélation) |
| UI / pages | **SvelteKit** + TypeScript strict |
| Moteur de règles | Package TS pur partagé client/serveur (`packages/engine`), sans dépendance au rendu |
| Serveur | **Node.js + Fastify**, WebSocket pour les parties et le chat de guilde |
| Base de données | **PostgreSQL** + **Redis** (matchmaking, sessions, classements, rate limiting) |
| Stockage images | **Cloudflare R2** + CDN |
| Paiement | Interface abstraite `PaymentProvider` (implémentation choisie plus tard, voir 14) |
| Tests | Vitest (moteur, économie), Playwright (E2E) |
| Monorepo | pnpm workspaces : `apps/web`, `apps/server`, `apps/admin`, `packages/engine`, `packages/shared`, `tools/pipeline` |

### Règles d'architecture
- **Serveur autoritaire** : résolution des parties, tirages, économie, achats, trade-up, échanges. Le client affiche et anime uniquement.
- **Moteur déterministe** : même état + mêmes actions + même seed = même résultat. Le client peut simuler pour l'animation ; le serveur fait foi.
- **RNG serveur sécurisé** (crypto) pour tous les tirages, avec seed enregistrée pour l'audit.
- Toutes les valeurs d'équilibrage dans des fichiers de config ou en base, **jamais en dur**.

---

## 3. Règles du jeu

> **Refonte du 2026-10-02** : le duel s'inspire du **TCG One Piece** (Leader, Vies, énergie, attaques, contres), en tour par tour. Les puissances sont divisées par 1000 pour rester lisibles (5 au lieu de 5000). Les marques et termes propres au TCG One Piece (« DON!! », etc.) ne sont pas repris. Détails de résolution : `packages/engine/README.md`.

### 3.1 Format d'une partie
- **1 Leader + deck de 20 cartes**, **2 exemplaires maximum** de chaque carte.
- Le **Leader** est une carte célèbre : il fixe les **2 catégories** autorisées dans le deck, ses **Vies** (4 ou 5), sa puissance (5) et un pouvoir.
- Mise en place : main de **5 cartes**, un **mulligan** possible (remélanger et repiocher une fois), puis autant de cartes **Vie** face cachée que la valeur de Vie du Leader.
- **Tour par tour.** Le premier joueur est tiré au sort ; il ne pioche pas et ne gagne qu'1 Buzz à son premier tour.
- Déroulement d'un tour :
  1. **Redressement** : toutes tes cartes redeviennent actives, les Buzz attachés reviennent.
  2. **Pioche** : 1 carte. Pioche vide au moment de piocher = défaite.
  3. **Buzz** : +2 Buzz (réserve totale de 10).
  4. **Phase principale**, dans l'ordre que tu veux :
     - jouer des Personnages (5 en jeu au maximum) et des Événements en dépensant du Buzz ;
     - attacher du Buzz à ton Leader ou à un Personnage (+1 puissance par Buzz, pendant ton tour) ;
     - activer des capacités ;
     - attaquer.
  5. **Fin de tour.**
- Minuteurs (serveur) : 60 s par tour, 20 s par réaction.

### 3.2 Combat
- On attaque en **épuisant** (tournant) son Leader ou un Personnage actif.
- **Cibles possibles** : le Leader adverse, ou un Personnage adverse **épuisé**.
- Personne n'attaque pendant son tout premier tour. Un Personnage ne peut pas attaquer le tour où il est joué, sauf s'il a **Élan**.
- Défense, dans l'ordre :
  1. **Blocage** : épuiser un **Bloqueur** actif, qui devient la cible.
  2. **Contre** : défausser des Personnages de sa main pour leur valeur de **Contre** (+1 ou +2 pendant ce combat), ou jouer des Événements [Contre] en payant leur coût avec le Buzz non dépensé.
- **L'attaque réussit si la puissance de l'attaquant est au moins égale à celle du défenseur.**
  - Contre un Personnage : il est **KO** (défausse).
  - Contre le Leader : il perd 1 **Vie**. La carte Vie va dans la main de son propriétaire, ou, si elle a un **[Déclencheur]**, il peut activer cet effet à la place (la carte va alors à la défausse).

### 3.3 Victoire
- Toucher le Leader adverse alors qu'il n'a **plus de Vie** = victoire.
- Un joueur qui doit piocher avec une pioche vide perd.
- Garde-fou : au-delà de 40 tours, le joueur qui a le plus de Vies gagne ; à égalité, match nul.

### 3.4 Hype (enjeu de classement, sans argent)
- En classé, une partie vaut 1 point de rang de base.
- Pendant son tour, chaque joueur peut une fois déclarer **Hype** : l'enjeu double **immédiatement** (1 → 2 → 4 maximum).
- Chaque joueur peut **Lâcher** (abandonner) à tout moment et ne perdre que l'enjeu actuel.
- Aucun lien avec une monnaie : uniquement des points de rang.

### 3.5 Structure d'une carte
```json
{
  "id": "fr_0042",
  "wikidataId": "Q517",
  "type": "character",
  "name": { "fr": "Napoléon Ier", "en": "Napoleon" },
  "categories": ["guerre_pouvoir"],
  "cost": 5,
  "power": 6,
  "counter": 1,
  "rarity": "viral",
  "series": "base",
  "country": "FR",
  "keywords": ["bloqueur"],
  "effects": [ /* voir 3.7 */ ],
  "flavor": { "fr": "Petit, mais a quand même ratio toute l'Europe.", "en": "..." },
  "flags": { "adult": false, "politicallySensitive": false },
  "image": { "assetId": "img_8812", "fallback": false }
}
```
- Types : **Leader** (`life`, coût 0), **Personnage** (`power`, `counter`), **Événement** (effets [Principale] et/ou [Contre]).

### 3.6 Moments d'effet
[Jouée], [Attaque], [KO], [Déclencheur] (carte Vie révélée), [Continu] (avec [Ton tour] / [Tour adverse] possibles), [Activation : principale] (1 fois par tour, coût en Buzz possible), [Fin de ton tour], et pour les Événements : [Principale] et [Contre].

### 3.7 Langage d'effets (DSL JSON)
Les effets sont des données, interprétées par le moteur. Pas de code spécifique par carte sauf exception documentée. **Les cibles sont choisies automatiquement** (le plus fort, le plus faible, au hasard…), pour que le jeu reste simple.

```json
{
  "trigger": "on_play",
  "condition": { "type": "count", "zone": "allies", "filter": { "categories": ["musique"] }, "min": 1 },
  "action": { "type": "ko", "target": "strongest_enemy", "filter": { "maxCost": 4 } }
}
```
- **Actions** : `add_power` (durée : tour, combat ou définitive), `ko`, `rest` (épuiser), `refresh` (redresser), `bounce` (renvoyer en main), `steal`, `cancel_effects`, `draw`, `discard`, `add_card_to_hand`, `add_buzz`, `random_of` (choix aléatoire seedé).
- **Cibles** : `self`, `my_leader`, `enemy_leader`, `allies`, `enemies`, `all_mine`, `strongest_enemy`, `weakest_enemy`, `random_enemy`, `strongest_ally`, `weakest_ally`, `battle_target`, `attacker`.

### 3.8 Mots-clés (culture internet)
Principe : **un mot-clé = une phrase, avec un chiffre visible**. Le texte affiché est généré depuis la config (`keywordText`).

| Mot-clé | Équivalent One Piece | Effet |
|---|---|---|
| **Élan** | Initiative (Rush) | Peut attaquer dès le tour où elle est jouée. |
| **Bloqueur** | Bloqueur | Quand l'adversaire attaque, tu peux l'épuiser pour qu'elle devienne la cible. |
| **Viral** | Double attaque | Quand elle touche le Leader adverse, il perd 2 Vies. |
| **Ratio** | Bannissement | Les Vies qu'elle retire vont à la défausse : ni Déclencheur, ni carte en main. |
| **Clickbait** | — | +2 quand elle attaque. |
| **Croissance** | — | +1 définitif à la fin de chacun de tes tours. |
| **Rickroll** | — | [Jouée] Épuise le Personnage adverse actif le plus fort (coût 5 max). |
| **Cancel** | — | [Jouée] Le Personnage adverse le plus fort perd ses effets. |
| **Séduction** | — | [Jouée] Vole le Personnage adverse le plus faible (coût 2 max). |
| **Shitpost** | — | [Jouée] Au hasard : pioche 1, +2 jusqu'à la fin du tour, ou +1 définitif. |
| **Tendance** | — | Bonus quotidien automatique de +1 (voir 8). |

Chaque nouvelle série mondiale ajoute **un nouveau mot-clé** (exemples prévus : *Chantage*, *Overdose*).

### 3.9 Équilibrage : budget de puissance
Puissance de référence d'un Personnage sans effet, par coût (≈ coût + 1) :

| Coût | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Puissance | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |

Une valeur de Contre élevée (+2) ou un effet se paie en puissance ; une carte sans Contre gagne +1. Chaque effet a une valeur en points de puissance. Un outil d'admin calcule le budget et signale les cartes hors norme. Ajustements ensuite à partir de simulations IA contre IA et des statistiques de victoire (section 15).

**Implémenté** (moteur, `cardBudget`) : valeurs des mots-clés, des actions et des moments d'effet dans `DEFAULT_BUDGET` (config), tolérance ±1. Un Événement doit valoir environ 0,6 × la référence de son coût. Calibré sur le prototype équilibré par simulation (46 cartes sur 52 dans la norme). Simulations IA contre IA : `simulateMatchup`.

> Les **terrains** du modèle précédent disparaissent. Ils pourront revenir comme cartes **Lieu** (effet continu, une par joueur) dans une série ultérieure.

---

## 4. Contenu : catégories et set de base

### 4.1 Les 10 catégories
| Catégorie (id) | Style de jeu | Cartes au lancement |
|---|---|---|
| Nuits et excès (`nuits_exces`) | Séduction, gros bonus puis malus | 24 |
| Crimes et scandales (`crimes_scandales`) | KO, défausse adverse | 24 |
| Mystères et complots (`mysteres`) | Hasard, renvoi en main | 24 |
| Guerre et pouvoir (`guerre_pouvoir`) | Puissance brute, renforts, Viral | 24 |
| Sport (`sport`) | Élan | 24 |
| Musique (`musique`) | Renforce les alliés | 24 |
| Séries et cinéma (`series_cinema`) | Bloqueurs, contres, Rickroll | 24 |
| Internet et jeux vidéo (`internet`) | Viral, Ratio, Clickbait, Cancel | 24 |
| Science et technologie (`science`) | Pioche, génère des cartes | 24 |
| Exploration et extrêmes (`exploration`) | Croissance, Buzz supplémentaire | 24 |
| Légendes (multi-catégories) | Cartes puissantes à 2 catégories | 10 |
| **Total** | | **250** |
| Leaders (hors total) | 2 catégories chacun | 15 au lancement, d'autres à chaque série |

- Les **Leaders ne comptent pas dans les 250** (ni dans les raretés de la section 4.2) : ils ne vont pas dans le deck et on en ajoute pour couvrir de nouvelles paires de catégories.
- Environ **15 % des cartes** ont 2 catégories (comptent pour les deux dans les synergies).
- La catégorie Internet est la plus mise en avant dans le marketing et l'interface.

### 4.2 Raretés (noms internet)
| Rareté (id) | Nom affiché | Cartes au lancement |
|---|---|---|
| `basique` | Basique | 110 |
| `tendance` | Tendance | 70 |
| `viral` | Viral | 45 |
| `iconique` | Iconique | 18 |
| `goat` | GOAT | 7 |

Chaque rareté a un cadre distinct en **forme et en couleur** (accessibilité daltonisme).

### 4.3 Courbe de coût du set de base
Coût 1 : 20 % · Coût 2 : 25 % · Coût 3 : 20 % · Coût 4 : 15 % · Coût 5 : 12 % · Coût 6 : 8 %.
Chaque Leader couvre 2 catégories ; chaque paire de catégories doit former un deck jouable.

### 4.4 Mini-série « Industrie X » (dans Nuits et excès)
- 10 à 12 cartes au lancement : 6 à 8 actrices et acteurs (époques et pays variés) + institutions, films devenus phénomènes de société, magazines, cérémonies, lieux.
- Mécanique principale : **Séduction**.
- Flag `adult: true` → soumis au filtrage par pays (section 9).

### 4.5 Séries
- **Série mondiale** : 60 à 80 cartes toutes les **8 semaines**, thème d'époque ou de lieu touchant toutes les catégories (ex. Années 80, Rock'n'roll, Jeux olympiques, Hollywood, Grandes explorations, Rome antique). Ajoute des Leaders + 1 mot-clé.
- **Série pays** : **40 cartes** toutes les **2 à 3 semaines**, entre les séries mondiales.

Modèle d'une série pays :
| Contenu | Cartes |
|---|---|
| Internet local (streamers, youtubeurs, mèmes, moments viraux) | 10 |
| Musique et séries locales | 8 |
| Sport | 5 |
| Histoire, guerre et pouvoir | 5 |
| Crimes, scandales, complots locaux | 5 |
| Nuits et excès (dont Industrie X locale si légal) | 4 |
| Science, exploration, divers | 3 |

- + 1 ou 2 Leaders du pays (bonus pour les cartes de leur pays, à définir).
- Ordre prévu : États-Unis, Brésil, France, Mexique/Espagne, Allemagne, Royaume-Uni, Japon, Philippines, Italie, Pologne.
- **Vote communautaire** (Discord / en jeu) pour 5 à 10 cartes de chaque série pays avant sa sortie.
- **Lancement = événement « Coupe du monde d'internet »** d'une semaine : classement entre nations.

### 4.6 Critère de notoriété : chaque carte doit être connue de la majorité
Règle centrale : un joueur de 21–40 ans doit reconnaître **la grande majorité des cartes** sans chercher. Une carte que personne ne connaît ne crée ni attachement ni partage.

**Score de notoriété** (calculé par le pipeline, pondérations en config) :
- **Portée internationale** (30 %) : nombre d'éditions linguistiques de Wikipédia ayant un article (sitelinks Wikidata).
- **Popularité** (50 %) : vues des **60 derniers jours** dans 10 langues (en, fr, es, pt, de, it, ja, pl, ru, zh), extrapolées sur un an. L'API « par article » sur 12 mois n'accepte qu'un article par requête et refuse vite les requêtes (HTTP 429) : intenable pour des milliers de sujets. Le pipeline utilise l'API MediaWiki par lots de 50 articles.
- **Pertinence générationnelle** (20 %) : période d'activité. Les sujets actifs depuis 1990 sont favorisés ; un sujet historique doit être de tout premier plan pour passer (ex. Napoléon, Cléopâtre). La tendance des vues sur 5 ans n'est pas mesurée (même limite d'API).

Chaque critère est converti en percentile **dans la catégorie principale du sujet** (un footballeur et un explorateur ne se comparent pas), puis le total pondéré est lui-même rangé : un score de 90 signifie « parmi les 10 % les plus connus de sa catégorie ». Les candidats GOAT (« iconiques ») sont le top 1 % de tout le lot.

**Seuils par type de série** (config) :
| Série | Exigence |
|---|---|
| Set de base | Score ≥ 90 **et** article dans au moins 40 langues ; **Crimes et Mystères** : score ≥ 50 et au moins 20 langues (peu de sujets très connus dans ces catégories, décision du 2026-10-03) |
| Séries mondiales | Score ≥ 80 **et** au moins 25 langues |
| Séries pays | Top des vues dans la langue du pays **et** connu de la majorité des joueurs du pays (voir test) ; idéalement 10 langues ou plus pour qu'une partie des cartes parle aussi aux étrangers |
| Industrie X | Uniquement les noms ayant dépassé le public adulte (présence dans les médias grands public, au moins 20 langues) |

**Rareté et notoriété** : la notoriété ne fixe pas la rareté. Les cartes les plus célèbres existent dans toutes les raretés ; les GOAT sont toutefois choisies parmi les sujets les plus **iconiques** (top 1 % du score).

**Test de reconnaissance avant chaque série**
- Avant publication, la liste des candidats est montrée à un échantillon de joueurs du pays cible via un **sondage en jeu facultatif** (récompense : quelques pièces) : « Connais-tu… ? Oui / Vaguement / Non ».
- Une carte est retenue si **au moins 60 %** des répondants répondent « Oui » (set de base : 60 % en moyenne sur les 5 principaux marchés).
- Les cartes rejetées peuvent revenir plus tard en carte « niche » dans une série thématique, jamais dans le set de base.

**Mesure en jeu après la sortie**
- Appui long sur une carte → fiche « Qui c'est ? » en une phrase + lien vers le Codex.
- Le taux d'ouverture de cette fiche par carte est suivi (`card_info_opened`). Une carte très consultée = notoriété insuffisante → ajustement des seuils pour les séries suivantes.

---

## 5. Politique de contenu (obligatoire pour le pipeline et la curation)

À appliquer à **chaque carte** avant publication. Le pipeline marque les cas douteux, un humain valide.

**Contrôles automatiques du pipeline** (`tools/pipeline/src/policy.ts`) :
- exclue d'office : personne mineure aujourd'hui ;
- à revoir (et contenu sensible) : attaque ou organisation terroriste, condamnation pour terrorisme, libellé ou description évoquant le terrorisme (« terroris… », « attentat ») ou la négation de la Shoah ;
- à revoir : cité comme victime d'un événement, condamnation, mort violente, overdose, Industrie X, mots sensibles dans la description ;
- drapeaux : `adult`, `sensitive` (masquable par le joueur), `politicallySensitive` (filtrage par pays).

**Marques** (sites, réseaux sociaux, jeux vidéo, entreprises : Wikipédia, YouTube, Minecraft…) : autorisées comme sujets de cartes, y compris en production (décision du 2026-10-03).

Dans l'outil d'admin, les raisons « à revoir » sont affichées pour information et ne bloquent pas la publication ; un sujet exclu (mineur aujourd'hui) ne peut jamais devenir une carte. Une carte s'enlève à la main : effacée si elle n'a jamais été publiée, retirée du jeu sinon (des joueurs ont pu l'obtenir).

**Exclusion automatique**
- Toute personne **encore mineure aujourd'hui** → exclue. Une carrière commencée avant 18 ans n'exclut pas (décision du 2026-10-02).

**Signalés pour information** (décision du 2026-10-03 : ni exclusion automatique ni validation humaine obligatoire ; l'admin publie ou enlève la carte) :
- **victimes** de crimes, d'attentats, de catastrophes ;
- attentats, figures terroristes, organisations terroristes ;
- négation de crimes contre l'humanité (ex. négation de la Shoah) ;
- performeurs X ayant publiquement dénoncé avoir été contraints ou exploités ;
- personnes privées (sans notoriété publique documentée).

**Règles pour les personnes réelles**
- Uniquement des faits publics et documentés (article Wikipédia de référence).
- Textes factuels, ton décalé autorisé, **jamais dégradant ni diffamatoire**.
- Performeurs X : nom de scène, carrière, récompenses, impact culturel. Aucune description sexuelle.
- Les effets de jeu ne doivent pas tourner en dérision un crime réel ou ses victimes.

**Procédure de retrait**
- Formulaire public « Demande de retrait » (page dédiée + lien sur chaque fiche de carte).
- Traitement prioritaire : retrait ou anonymisation sous 72 h depuis l'outil d'admin (section 12).
- Une carte retirée : désactivée en jeu, compensée en pièces (section 6). **Implémenté** (phase 5) : chaque détenteur reçoit le prix de fabrication de la carte par exemplaire, la carte quitte collections, decks et échanges en attente, et le joueur reçoit une notification.

---

## 6. Économie

### 6.1 Monnaies
| Monnaie | Gagnée en jeu | Achetable | Usage |
|---|---|---|---|
| Pièces | Oui (parties, recyclage des doublons) | Non | Boosters standards, crafting de cartes au choix |
| Gemmes | Un peu (succès, pass) | Oui | Boosters premium, cosmétiques, pass |
| Jetons de guilde | Activité de guilde | **Non** | Boutique de guilde |

> L'essence a été **fusionnée dans les pièces** le 2026-10-03 : une seule monnaie gagnée en jeu. Le recyclage rapporte des pièces et le crafting en coûte.

### 6.2 Boosters avec aperçu (aucun hasard à l'achat)
- Plusieurs types de boosters : Base, Série mondiale en cours, chaque Série pays. Taille : 5 cartes.
- Pour chaque joueur et chaque type, le serveur génère un **aperçu** : les 5 cartes exactes du prochain booster, **verrouillées en base**.
- L'acheteur reçoit **exactement** les cartes de l'aperçu. Aucune carte mystère.
- **Après un achat**, un nouvel aperçu est généré **immédiatement**.
- **Sans achat**, l'aperçu se renouvelle automatiquement **toutes les 24 h** (minuteur affiché).
- **Interdits absolus** :
  - renouveler un aperçu contre de l'argent, des gemmes ou toute monnaie achetable ;
  - accélérer le minuteur par quelque moyen payant que ce soit ;
  - vendre des boosters à contenu caché.
- Les **probabilités de génération** des aperçus sont affichées.
- Les boosters **gagnés gratuitement** (récompenses) peuvent s'ouvrir avec contenu aléatoire, car aucune somme n'est engagée.
- **Pas de kit de départ** : un nouveau compte reçoit **6 boosters gratuits** et choisit **un Leader de départ** (une seule fois). Le joueur construit ensuite son deck avec ses ouvertures, ses achats en pièces et le crafting. L'entraînement hors ligne garde ses decks préconstruits.
- **Pièces** gagnées en partie en ligne : victoire 40, défaite 15, nul 20, plafond 400 par jour (config). Booster de base : 100 pièces.

### 6.3 Crafting
- Doublons au-delà de 2 exemplaires (le maximum par deck, `keepCopies` en config) → recyclables en pièces. Le crafting complète jusqu'à ce même nombre.
- Toute carte d'une série publiée peut être fabriquée avec des pièces. Coûts par rareté : 20 / 50 / 150 / 500 / 1500 (config).
- Recyclage : 1 / 3 / 10 / 30 / 100 pièces (config). Recycler un booster rapporte en moyenne environ un quart de son prix : acheter des boosters pour les recycler n'est jamais rentable (vérifié par un test).

### 6.4 Trade-up
- **5 doublons de même rareté** → 1 carte aléatoire de la rareté supérieure, **non possédée** par le joueur si possible.
- **Trade-up ciblé** : 8 doublons → le joueur choisit la catégorie de la carte obtenue.
- Probabilités affichées. Aucun coût en monnaie : le trade-up n'est **jamais** alimenté par de l'argent réel ou des gemmes.
- Tirage côté serveur, enregistré (`trade_ups`).
- **Implémenté** (phase 5) : `GET /api/trade-up` (cartes possibles, toutes équiprobables, et probabilité affichée avant l'échange) et `POST /api/trade-up`. Les doublons sont ceux au-delà des exemplaires jouables (`keepCopies`) ; la seed et les cartes possibles sont enregistrées, donc chaque tirage peut être rejoué pour l'audit. Nombres de doublons en config (`tradeUp`). Rubrique dédiée « Trade-up » (`/trade-up`) : le joueur choisit lui-même les doublons qu'il donne (ou « Compléter » automatiquement).

### 6.5 Échanges entre joueurs
- **Échange libre entre amis** (décision du 2026-10-03) : cartes uniquement, autant que voulu de chaque côté, raretés libres, et **dons** compris (un côté vide). Aucune limite par jour ni par semaine.
- Entre amis (demande puis acceptation, **sans délai**, décision du 2026-10-03), et plus tard entre membres d'une même guilde (phase 7). Les pseudos n'étant pas uniques, on ajoute un ami par son **code ami** (8 caractères), ou par pseudo s'il est unique.
- Aucune monnaie, aucun objet dans un échange. Les CGU interdisent la vente de cartes ou de comptes contre de l'argent.
- Tableau d'échanges de guilde (« je cherche / je propose »).
- **Decks** : on peut donner un exemplaire qu'on utilise dans un deck ; la carte quitte alors ce deck, et la page le signale. Un Leader donné reste en tête du deck, qui demande alors un autre Leader.
- **Acceptation** : le serveur revérifie tout (amitié, possession, cartes autorisées dans les deux pays), puis les cartes changent de main d'un coup. Une proposition expire après 72 h (config).
- Les comptes liés (même empreinte numérique, cookie d'appareil ou IP, section 14) peuvent échanger : ils restent signalés pour revue (décision du 2026-10-03).
- **Implémenté** (phase 5) : amis (code ami, demandes, acceptation, retrait) et échanges libres (proposition, acceptation, refus, annulation, expiration). Rubriques « Amis » (`/friends`) et « Échanges » (`/trades`). Reste : tableau de guilde (phase 7).

### 6.6 Monétisation
- **Gemmes** : 6 paliers de prix, prix régionaux (table `price_tiers` par pays).
- **Pass saisonnier** (28 jours) : piste gratuite, piste premium, piste deluxe (variantes exclusives). **Implémenté** (phase 6) : 30 niveaux, pistes payantes achetées directement en argent réel (premium 9,99 €, deluxe 14,99 €, passage au deluxe 5 € ; décision du 2026-10-03), récompenses payantes limitées aux cosmétiques (titres, variantes) et aux boosters à aperçu, variantes visibles en collection et en partie.
- **Variantes cosmétiques** de cartes (même carte, même stats) : holographique, cadre animé, filtre « glitch », pixel, doré, négatif, VHS.
- **Cosmétiques** : dos de cartes, plateaux, avatars, titres, emotes.
- ~~Boutique quotidienne~~ : abandonnée (décision du 2026-10-03).
- **Aucune carte sous licence officielle** et aucun avantage de jeu achetable hors boosters prévisualisés.
- **Implémenté** (phase 5) : 6 packs de gemmes (80 à 5 200 gemmes, 0,99 € à 49,99 €), prix régionaux pour les pays de lancement (table `price_tiers`, pays « * » par défaut), boutique (`/shop`), historique d'achats et plafond de dépense mensuel facultatif. Les gemmes n'ont pas encore d'usage (cosmétiques et pass à venir).

---

## 7. Modes de jeu

| Mode | Description |
|---|---|
| **Classé** | Saisons mensuelles, rangs : Lurker → Normie → Posteur → Influenceur → Viral → Légende (+ classement top 1000 par pays et mondial). Reset partiel en fin de saison, récompenses de fin de saison. |
| **Casual** | Sans enjeu de rang. |
| **Asynchrone / fantôme** | Partie instantanée contre le deck enregistré d'un vrai joueur piloté par une IA. Utilisé aussi quand le matchmaking dépasse 15 s. |
| **Défi du jour** | Deck imposé, même pour tous, score partagé en image (style Wordle). |
| **Draft du week-end** | Construction d'un deck à partir de cartes proposées, entrée gratuite (1 par week-end) ou en pièces. |
| **Tournois** | Hebdomadaires, brackets automatiques. |
| **Amical** | Entre amis et membres de guilde. |
| **Spectateur / replays** | Regarder les parties des meilleurs joueurs, rediffusion de ses propres parties. |

---

## 8. Système « Tendance du jour »

- Tâche quotidienne (cron, 06:00 UTC) qui récupère via l'**API Wikimedia Pageviews** les vues des articles liés à chaque carte.
- Score de tendance = vues de la veille / moyenne des 30 jours précédents.
- Les **10 cartes** au score le plus élevé (avec un minimum de vues) reçoivent le mot-clé **Tendance** pour 24 h : **+1 puissance** et un cadre « En tendance ».
- Affichage : page « Tendances » + notification du matin.
- Exclure du bonus toute carte dont la tendance est liée à un décès ou un drame récent (liste de surveillance manuelle + vérification admin avant publication automatique à 06:30).

---

## 9. International et filtrage par pays

- **i18n** : clés partout, fichiers JSON par langue. Lancement : EN, FR, ES, PT-BR, DE. Puis JA, IT, PL, TL.
- Pays du joueur : pays déclaré à l'inscription + vérification par IP.
- Table `country_rules` : pour chaque pays, flags autorisés (`adult`, `politicallySensitive`, liste de cartes bloquées). Le mécanisme existe ; le contenu des règles pays par pays est reporté à plus tard (décision du 2026-10-03).
- Dans un pays où le contenu adulte est interdit (ex. Turquie, Corée du Sud, Inde, à confirmer juridiquement) :
  - cartes `adult` masquées dans la collection, absentes des aperçus de boosters, non jouables ;
  - les parties contre un joueur d'un autre pays affichent ces cartes avec un design neutre (« Carte masquée dans ta région ») ;
  - jamais de compensation monétaire nécessaire puisqu'elles ne peuvent pas y être obtenues.
- Les séries pays peuvent avoir des variantes de contenu selon le pays d'affichage.

---

## 10. Illustrations : uniquement des images libres

### 10.1 Sources et licences
- Source principale : **Wikimedia Commons** (API `imageinfo` + `extmetadata`).
- **Licences acceptées** : domaine public, CC0, CC BY (toutes versions), CC BY-SA (toutes versions).
- **Rejetées automatiquement** : toute licence NC, ND, toute image « non libre » / fair use, toute image sans licence claire.
- Enregistrer pour chaque image : URL d'origine, auteur, licence, URL de la licence, mention de modification, avertissement de droits de la personnalité éventuel.

### 10.2 Crédits
- Ligne de crédit sur la fiche détaillée de chaque carte : « Photo : [auteur], [licence], modifiée ».
- Page publique **Crédits** listant toutes les images.
- Les illustrations dérivées d'images CC BY-SA sont publiées sous CC BY-SA (le rendre explicite sur la page Crédits).

### 10.3 Traitement visuel commun
- Recadrage automatique centré sur le visage ou le sujet (détection de visage), format carte.
- Filtre de couleur selon la catégorie (duotone ou bichromie) pour unifier des photos de qualités différentes.
- Cadre de rareté, icônes de catégorie, coût, puissance.
- Les images ne sont **jamais sexualisées** : portraits neutres uniquement pour les performeurs X.

### 10.4 Carte de secours
- Si aucune image valide : design **typographique** par catégorie (nom en grand, icône, motif propre à la catégorie). Ce style doit être soigné, pas un placeholder.

### 10.5 Mèmes
- Les cartes de mèmes représentent le **concept**, jamais l'image originale (souvent protégée). Utiliser la carte typographique ou une image libre évocatrice.

---

## 11. Pipeline de création de cartes (`tools/pipeline`)

1. **Extraction Wikidata (SPARQL)** par pays et catégorie : personnes, événements, lieux, œuvres. Champs : QID, libellés multilingues, pays, dates, occupation, nombre de sitelinks.
2. **Score de notoriété** (section 4.6) : sitelinks, vues des 60 derniers jours dans 10 langues, activité depuis 1990. Les sujets sous le seuil de la série sont signalés (« sous le seuil »).
3. **Pré-filtrage automatique** selon la politique de contenu (section 5) : âge actuel, terrorisme, victimes, condamnations, morts violentes, occupations à risque, mots-clés sensibles → `excluded` ou `needs_review`.
4. **Export d'une liste courte** (CSV + vue admin), triée par popularité et catégorie.
5. **Curation humaine** dans l'outil d'admin : sélection, catégorie(s), rareté.
6. **Stats et effets** : proposés par lots de brouillons (`tools/pipeline/drafts/<série>.json`) dans le style de la catégorie (section 4.1), vérifiés par le budget de puissance (3.9) ; ajustement dans l'éditeur.
7. **Textes** : nom + texte d'ambiance (flavor) multilingues, relecture par un ambassadeur local.
8. **Images** : récupération Commons + filtre de licences + traitement (section 10).
9. **Validation finale** et publication dans une série (statut `draft` → `review` → `published`).

Commandes CLI (`pnpm --filter @rabbithole/pipeline pipeline <commande>`) : `extract --series base_01 [--country FR] [--categories musique,sport]`, `score [--refresh]`, `policy`, `images`, `export` (CSV), `validate` (bilan), `all`. Résultats dans `tools/pipeline/out/<série>.json`, importés dans l'admin (page Candidats). Détails : `tools/pipeline/README.md`.

Premier passage sur le set de base (2026-10-02) : 3 672 candidats (55 sources, ≥ 40 langues), 3 191 avec une image libre ; 9 exclus, 270 à revoir ; premier lot de 30 cartes en brouillon.

---

## 12. Outil d'administration (`apps/admin`)

- Éditeur de cartes (stats, effets en DSL avec validation, textes, catégories, flags).
- Calculateur de budget de puissance + alertes.
- Gestion des séries, Leaders, mots-clés, raretés.
- Gestion des images : remplacement, crédits, retrait en un clic.
- **File des demandes de retrait** avec horodatage et statut.
- Gestion de `country_rules` et des listes de cartes bloquées.
- Tableaux de bord d'équilibrage : taux de victoire, taux de jeu par carte et par Leader, simulations IA contre IA.
- Gestion de la boutique, des prix régionaux, du pass, des événements.
- Journal d'audit de toutes les actions admin.

**Implémenté** (phase 4) : accès par rôle (`ADMIN_EMAILS`) ; import des candidats du pipeline (filtres, retenir / rejeter, carte créée en brouillon prérempli) ; import de lots de brouillons ; éditeur avec aperçu en direct (validation du moteur, budget, texte de la carte), statuts brouillon → relecture → publiée → retirée, suppression manuelle ; raisons de la politique de contenu affichées pour information ; images et crédits, retrait en un clic ; séries ; file des signalements ; file des demandes de retrait (échéance 72 h, retrait de la carte en un clic) ; règles par pays ; budget du catalogue et simulations IA contre IA ; journal d'audit. **À venir** : éditeur dédié des Leaders et des mots-clés, statistiques de victoire réelles par carte (section 15), boutique, prix régionaux, pass, événements.

---

## 13. Social et rétention

- **Guildes** (30 membres, 40 au niveau 10) : rôles chef / adjoints / membres, niveaux et bonus, demandes de cartes et dons, tableau d'échanges, tournoi de guilde hebdomadaire, amicaux, boutique de guilde en jetons. Chat : réactions et messages prédéfinis traduits ; chat libre optionnel avec filtre et signalement.
- **Amis** : code ami, amicaux, échanges, comparaison de collections.
- **Missions** quotidiennes et hebdomadaires (alimentent le pass). **Implémenté** (phase 6) : 3 par jour et 3 par semaine, tirées par le serveur parmi les modèles de la config, progression comptée côté serveur, récompense en pièces (et points de pass enregistrés), page Missions.
- **Progression de collection** : chaque carte nouvelle et chaque partie font avancer une barre de récompenses.
- **Succès et titres**.
- **Partage** : génération d'un clip vertical (format 9:16) ou d'une image de fin de partie à partager en un tap.
- **Rappels de pause** optionnels après 2 h de jeu continu.

---

## 14. Paiement, comptes et conformité

- **Âge** : aucune condition d'âge à l'inscription (ni date de naissance, ni déclaration).
- **Contenu sensible** (à venir) : un interrupteur on/off par joueur masque les cartes marquées sensibles (`flags` de la carte), en plus du filtrage par pays (section 9).
- **Signalement** (à venir) : tout joueur peut signaler une carte, un pseudo ou un comportement ; les signalements arrivent dans l'outil d'administration.
- **Inscription protégée** (`apps/server/src/auth/`) :
  - **robots** : captcha invisible Cloudflare Turnstile (la case n'apparaît qu'en cas de doute) ; champ pot de miel caché ; 3 tentatives par minute et par IP, 10 par sous-réseau (/24 ou /64), puis blocage de 15 min ;
  - **e-mails** : domaines jetables refusés (liste embarquée de plusieurs milliers de domaines + liste communautaire rafraîchie chaque jour) ; alias interdits (tout ce qui suit un « + » est retiré, points ignorés chez Gmail) avant le contrôle d'unicité ;
  - **appareil** : un compte par appareil, reconnu par son **empreinte numérique** (processeur, carte graphique, mémoire, écran, polices installées, langues, rendu canvas et audio, paramètres WebGL), qui résiste à l'effacement des cookies et à la navigation privée, ou par le cookie d'appareil. Une empreinte déjà connue bloque l'inscription depuis la même IP ; depuis une autre IP (deux téléphones du même modèle peuvent se ressembler), un SMS est demandé. `FINGERPRINT_STRICT=true` bloque partout ;
  - **VPN et proxys** détectés (proxycheck.io) → SMS demandé ;
  - **SMS** (`SMS_MODE` : `off`, `risky` par défaut, `always`) : code à 6 chiffres valable 10 min, 5 essais ; **un numéro = un compte** ; numéros virtuels (VoIP), surtaxés, fixes et pays hors liste refusés ; 3 SMS par numéro et 5 par IP et par heure. Si les SMS sont désactivés, les VPN sont refusés ;
  - IP, appareils et numéros ne sont stockés que sous forme d'**empreinte salée**. Les comptes qui partagent un appareil ou une IP sont signalés (`account_flags`) ; ils sont signalés pour revue (les échanges entre comptes liés restent permis, section 6.5).
  - ⚠️ RGPD : empreinte d'appareil et vérification d'IP par un tiers relèvent de l'intérêt légitime (lutte contre la fraude) et doivent figurer dans la politique de confidentialité.
- **Paiement** : interface `PaymentProvider` (`createCheckout`, `verifyWebhook`, `refund`). Les produits ne sont crédités **que** via webhook serveur vérifié et idempotent (`provider_transaction_id` unique). Gestion des remboursements et rétrofacturations. **Implémenté** (phase 5) : prestataire **sandbox** (`PAYMENT_PROVIDER=sandbox`, interdit en production, où la boutique est fermée tant qu'aucun prestataire n'est branché) dont la page de paiement factice fait envoyer un webhook signé HMAC ; transactions `pending` → `completed` uniquement par webhook ; événements rejoués sans effet (`payment_events`) ; montant ou devise incohérents jamais crédités (`mismatch`, signalé) ; remboursement et rétrofacturation retirent les gemmes (rétrofacturation signalée dans le journal d'audit).
- ⚠️ Le choix du prestataire n'est pas arrêté : la présence de cartes liées à l'industrie X peut faire classer le site « adulte ». Prévoir l'implémentation sandbox d'un prestataire classique **et** la possibilité d'en brancher un spécialisé (CCBill, Segpay, Verotel) sans changer le reste du code.
- **RGPD** : consentement cookies, export et suppression des données.
- **Transparence** : probabilités affichées (aperçus, trade-up, boosters gratuits), historique d'achats, plafond de dépense personnel facultatif.
- À valider par un avocat spécialisé avant lancement : aperçus de boosters, trade-up, échanges, contenu adulte par pays.

---

## 15. Analytics

Événements : `signup`, `session_start`, `match_start`, `match_end` (Leader, deck, résultat, durée, Vies restantes, Hype), `card_played`, `preview_viewed`, `preview_refreshed`, `booster_purchased`, `trade_up`, `trade_completed`, `craft`, `pass_purchase`, `share_clip`, `guild_join`, `takedown_request`, `card_info_opened`, `recognition_survey_answer`.

KPIs : rétention J1 / J7 / J30, parties par jour, durée moyenne de partie, conversion payante, ARPDAU, taux de victoire par carte (équilibrage), taux de consultation quotidienne des aperçus.

---

## 16. Modèle de données (PostgreSQL, simplifié)

```sql
users(id, created_at, country, locale, email UNIQUE, canonical_email UNIQUE, phone_hash UNIQUE,
      phone_verified_at, starter_leader, role /*player|admin*/, show_sensitive BOOLEAN, auth_provider, status)
pending_signups(id, payload JSONB, signals JSONB, reasons TEXT[], phone_hash, code_hash, attempts, expires_at)
sms_sends(phone_hash, ip_hash, created_at)
user_devices(device_hash, user_id, kind /*cookie|fp*/, first_seen, last_seen) / user_ips(ip_hash, user_id, first_seen, last_seen)
account_flags(user_id, other_user_id, reason /*shared_device|shared_ip*/, created_at)
cards(id, series_id, wikidata_id, status /*draft|review|published|retired*/, def JSONB /*CardDef du moteur*/,
      version, policy_status, policy_reasons TEXT[], policy_cleared_by, policy_note, created_at, updated_at)
card_images(id, card_id, source_url, file_page, author, license, license_url, modified BOOLEAN,
            personality_warning BOOLEAN, r2_key, active BOOLEAN)
series(id, type /*prototype|tokens|base|world|country*/, country, name JSONB, release_at, status)
catalog_versions(version, cards JSONB, created_at)   -- chaque catalogue publié, pour rejouer les replays
candidates(qid, run_series, data JSONB, status /*new|shortlisted|rejected|carded*/, primary_category,
           policy_status, score, card_id, imported_at, updated_at)
reports(id, reporter_id, target_type /*card|player*/, card_id, target_user_id, match_id, reason, details,
        status /*open|resolved|dismissed*/, resolution, resolved_by, created_at, resolved_at)
keywords(id, definition JSONB, effect JSONB)
country_rules(country, allow_adult, allow_political, blocked_card_ids TEXT[])
collections(user_id, card_id, quantity, variants JSONB)
decks(id, user_id, name, leader_id, card_ids TEXT[], updated_at)
series_decks(id, series_id, name JSONB, description JSONB, leader_id, card_ids TEXT[])   -- decks de référence
wallets(user_id, coins, gems /*peut être négatif après un remboursement*/, guild_tokens, free_boosters)
coin_ledger(id, user_id, currency, delta, reason, ref, created_at)
booster_openings(id, user_id, booster_type, card_ids TEXT[], seed, paid, created_at)
booster_previews(user_id, booster_type, card_ids TEXT[], seed, generated_at, refresh_at)
trade_ups(id, user_id, input_card_ids TEXT[], input_rarity, target_category, pool_card_ids TEXT[], output_card_id, seed, created_at)
users.friend_code (unique)
friendships(requester_id, addressee_id, created_at, accepted_at)
trades(id, from_user, to_user, status /*pending|accepted|declined|cancelled|expired*/, created_at, expires_at, resolved_at)
trade_items(trade_id, side /*offered|requested*/, card_id, quantity)
matches(id, mode, player_a, player_b, leader_a, leader_b, ghost BOOLEAN, seed, actions JSONB,
        result, hype_level, created_at)
ranked(user_id, season_id, rank, points, country)
trending(date, card_id, score)
guilds(id, name, emblem JSONB, language, level, xp) / guild_members(guild_id, user_id, role, tokens)
guild_requests(id, guild_id, user_id, card_id, filled, expires_at)
passes(user_id, season_id, tier, points, claimed JSONB)
products(id, type, name JSONB, contents JSONB, sort, active) / price_tiers(product_id, country /* * = défaut */, currency, amount /*unité mineure*/)
transactions(id, user_id, product_id, contents JSONB, provider, provider_session_id, provider_transaction_id UNIQUE, amount,
             currency, status /*pending|completed|cancelled|refunded|chargeback|mismatch*/, created_at, completed_at, refunded_at)
payment_events(provider, event_id, type, received_at)   -- idempotence des webhooks
users.monthly_spend_cap
takedown_requests(id, card_id, requester_name, requester_contact, relation, reason,
                  status /*open|in_progress|done|rejected*/, resolution, created_at, due_at /*+72 h*/, resolved_at)
admin_audit(id, admin_id, action, target, payload JSONB, created_at)
```

---

## 17. API (extraits)

```
POST /auth/signup  POST /auth/login
GET  /me  GET /collection  GET/POST/PUT /decks
WS   /match            (matchmaking, actions de tour, révélation, fin)
GET  /replays/:id
GET  /boosters/previews          → aperçus par type + minuteurs
POST /boosters/:type/purchase    → achète l'aperçu actuel exact
POST /craft  POST /recycle  POST /trade-up
GET/POST /friends  POST /friends/:id/accept  DELETE /friends/:id  GET /friends/:id/collection
GET/POST /trades  POST /trades/:id/accept|decline|cancel
GET  /trending
GET  /ranked/leaderboard?country=FR
GET  /shop  POST /shop/checkout  POST /webhooks/payment/:provider  GET /purchases  POST /me/spend-cap
GET/POST /guilds ...  WS /guilds/:id/chat
POST /takedown
```

---

## 18. Hébergement

- Front : **Cloudflare Pages** ; images : **Cloudflare R2** ; Cloudflare en DNS + protection DDoS.
- Serveur + WebSocket : **Fly.io** (Docker), régions Europe d'abord.
- PostgreSQL : **Neon** (région UE) ; Redis : **Upstash**.
- Environnements **staging** et **production** ; déploiement via **GitHub Actions** (tests → build → deploy).
- **Sentry** (client + serveur), surveillance de disponibilité, sauvegardes de base vérifiées.
- Fournir Dockerfiles, `fly.toml`, workflows CI.

---

## 19. Plan de développement

### Phase 1 — Moteur de règles
- `packages/engine` : état de partie, tours, combat (attaque, blocage, contres), Vies et Déclencheurs, DSL d'effets, mots-clés, Hype.
- Tests unitaires exhaustifs (chaque mot-clé, chaque action, cas d'égalité, déterminisme avec seed).

### Phase 2 — Prototype jouable local
- Rendu PixiJS : plateau, main, pose, révélation animée, fin de partie.
- 5 Leaders et 50 cartes de test en JSON. Partie contre une IA simple.

### Phase 3 — Serveur et comptes
- Fastify, PostgreSQL, comptes, collections, decks, matchmaking WebSocket, mode fantôme, replays.
- Ajouté en fin de phase : anti-double compte, et une partie de l'économie avancée (pièces, aperçus, boosters gratuits, recyclage, crafting).

### Phase 4 — Pipeline de contenu et admin
- `tools/pipeline` (Wikidata, Pageviews, Commons, filtres de licences, traitement d'images, carte typographique de secours).
- `apps/admin` (éditeur, budget de puissance, retraits, country_rules).
- Production du set de base de 250 cartes.
- **État : validée le 2026-10-03.** Code terminé (catalogue en base, pipeline, admin, signalements, contenu sensible, retraits, crédits, règles par pays). Set de base complet en dev : 250 cartes (24 par catégorie, 10 Légendes) et 15 Leaders, 15 decks de référence équilibrés. Reste : illustrations en jeu (R2).

### Phase 5 — Économie
- Monnaies, aperçus de boosters (verrouillage serveur, minuteur 24 h, renouvellement après achat), crafting, recyclage, trade-up, échanges.
- `PaymentProvider` en sandbox, prix régionaux, webhooks.
- **État : validée le 2026-10-03.** Trade-up, amis et échanges libres, gemmes et paiement sandbox, fusion pièces et essence, compensation des cartes retirées ; boutique quotidienne abandonnée. Reste pour la mise en ligne : le prestataire de paiement réel.
- **Déjà fait en phase 3** : pièces, aperçus de boosters, boosters gratuits, recyclage, crafting.

### Phase 6 — Rétention
- Classé et saisons, missions, pass (3 pistes), progression de collection, succès, défi du jour, draft, tournois, Tendance du jour, partage de clips.

### Phase 7 — Social
- Guildes complètes, amis, chat, spectateur.

### Phase 8 — International et lancement
- i18n complète, filtrage par pays, première série pays (États-Unis), événement Coupe du monde d'internet, analytics, hébergement production, page Crédits, page de retrait.

---

## 20. Consignes pour Claude Code

- TypeScript strict partout. Aucune logique de jeu ou d'économie dans les composants d'UI.
- Moteur de règles testé avant tout rendu.
- Aucun tirage aléatoire côté client. Aucun crédit d'achat côté client.
- Ne jamais implémenter de renouvellement payant des aperçus ni d'achat à contenu caché.
- Toute carte doit passer la politique de contenu (section 5) avant publication.
- Toute image doit avoir une licence acceptée et un crédit enregistré.
- Demande validation à la fin de chaque phase.
