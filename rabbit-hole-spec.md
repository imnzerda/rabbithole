# RABBIT HOLE — Cahier des charges

> **Nom du jeu : RABBIT HOLE** — accroche : *Fall into everything.*
> Le nom évoque le fait de se perdre de lien en lien sur internet, comme le joueur passe d'une carte à l'autre. Identité visuelle : un lapin stylisé (mascotte et logo) et un motif de « terrier » / spirale. Ces éléments servent pour le logo, l'écran de chargement, les dos de cartes par défaut et les animations d'ouverture de booster (la carte « tombe » du terrier).
> Note : « Viral » reste le nom d'une rareté et d'un mot-clé de jeu ; ce n'est plus le nom du jeu.

> Document destiné à Claude Code. Il décrit le jeu, les règles, l'économie, le contenu, l'architecture et l'ordre de développement. Développe **phase par phase** (section 17) et demande validation à la fin de chaque phase avant de continuer.

---

## 1. Vision

TCG (jeu de cartes à collectionner) jouable dans le navigateur, desktop et mobile. Les cartes représentent des personnes, événements, lieux et phénomènes réels issus de Wikipédia / Wikidata : de la culture internet à l'histoire, du sport aux scandales, en passant par l'industrie X.

- **Public** : adultes 21+, cœur de cible 21–40 ans.
- **International** dès le lancement, avec des séries par pays.
- **Identité** : la culture internet est l'ADN du jeu (mécaniques, raretés, interface, ton).
- **Ton** : ironique, décalé, adulte, mais **aucune image explicite**.
- **Parties de 3 minutes**, tours simultanés.
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

### 3.1 Format d'une partie
- **Deck : 12 cartes**, 1 exemplaire maximum de chaque carte.
- **3 terrains**, révélés progressivement : terrain 1 au tour 1, terrain 2 au tour 2, terrain 3 au tour 3. On ne peut poser que sur les terrains révélés.
- **6 tours**. Mana disponible = numéro du tour (1 au tour 1, 6 au tour 6). Le mana non utilisé est perdu.
- Main de départ : 3 cartes. Pioche de 1 carte au début de chaque tour. Main max : 7.
- **Tours simultanés** : les deux joueurs posent leurs cartes face cachée (timer de 30 s par tour), puis tout est révélé.
- **Ordre de révélation** : le joueur qui mène au score total révèle en premier ; égalité → tirage au sort annoncé au début du tour.
- Max **4 cartes par joueur et par terrain**.

### 3.2 Victoire
- Un joueur **contrôle un terrain** s'il y a la puissance totale la plus élevée.
- Il faut **contrôler 2 terrains sur 3**.
- Si aucun joueur n'en contrôle 2 → victoire à la puissance totale sur les 3 terrains. Égalité parfaite → match nul.

### 3.3 Hype (enjeu de classement, sans argent)
- En classé, une partie vaut 1 point de rang de base.
- Chaque joueur peut une fois déclarer **Hype** : l'enjeu double **immédiatement** (1 → 2 → 4 maximum). Pas de doublement automatique caché.
- L'adversaire peut **Lâcher** (abandonner) à tout moment et ne perdre que l'enjeu actuel.
- Aucun lien avec une monnaie : uniquement des points de rang.

### 3.4 Structure d'une carte
```json
{
  "id": "fr_0042",
  "wikidataId": "Q517",
  "name": { "fr": "Napoléon Ier", "en": "Napoleon" },
  "categories": ["guerre_pouvoir"],
  "cost": 5,
  "power": 7,
  "rarity": "viral",
  "series": "base",
  "country": "FR",
  "keywords": ["croissance"],
  "effects": [ /* voir 3.6 */ ],
  "flavor": { "fr": "Petit, mais a quand même ratio toute l'Europe.", "en": "..." },
  "flags": { "adult": false, "politicallySensitive": false },
  "image": { "assetId": "img_8812", "fallback": false }
}
```

### 3.5 Types d'effets
- **À la révélation** : se déclenche une fois quand la carte est révélée.
- **Continu** : actif tant que la carte est en jeu.
- **Fin de partie** : se déclenche après le tour 6, avant le décompte.

### 3.6 Langage d'effets (DSL JSON)
Les effets sont des données, interprétées par le moteur. Pas de code spécifique par carte sauf exception documentée.

```json
{
  "trigger": "on_reveal",
  "condition": { "type": "terrain_has_category", "category": "musique", "min": 2 },
  "action": { "type": "add_power", "target": "self", "amount": 3 }
}
```
Actions de base : `add_power`, `set_power`, `destroy`, `move`, `copy`, `transform`, `steal` (changer de camp), `draw`, `discard`, `add_card_to_hand`, `hide`, `cancel_effects`, `random_of` (choix aléatoire seedé).
Cibles : `self`, `allies_here`, `enemies_here`, `opposite_card`, `random_enemy_here`, `all_here`, `strongest_enemy_here`, `weakest_enemy_here`, `hand`, `deck`.

### 3.7 Mots-clés (culture internet)
Principe : **un mot-clé = une phrase, avec un chiffre visible**. Aucune information trompeuse ni règle cachée. Les chiffres sont en config, et le texte affiché est généré depuis la config (`keywordText`).

| Mot-clé | Effet |
|---|---|
| **Viral** | À la révélation : crée une copie de cette carte (puissance –1) sur un autre terrain aléatoire. |
| **Ratio** | À la révélation : la carte adverse la plus forte ici perd 3. |
| **Cancel** | À la révélation : la carte adverse la plus forte ici qui a un effet perd ses effets. |
| **Clickbait** | +4 puissance jusqu'à la fin du tour suivant (bonus réel, visible de tous). |
| **Rickroll** | À la révélation : envoie la carte adverse la plus forte ici sur un autre terrain. |
| **Shitpost** | À la révélation : gagne entre +0 et +8 au hasard. |
| **Séduction** | À la révélation : vole la carte adverse la plus faible ici. |
| **Élan** | +2 puissance si jouée aux tours 1 à 3. |
| **Croissance** | +1 puissance à chaque fin de tour. |
| **Tendance** | Bonus quotidien automatique de +1 (voir 8). |

> Version simplifiée du 2026-10-01. Live a été fusionné dans Croissance. Détails de résolution : `packages/engine/README.md`.

Chaque nouvelle série mondiale ajoute **un nouveau mot-clé** (exemples prévus : *Chantage*, *Overdose*).

### 3.8 Terrains
- Un terrain = nom + effet + éventuelle catégorie ou pays favorisé.
- Exemples : *Prohibition* (les cartes Crimes et scandales +2), *Stade* (Élan déclenché à tous les tours), *Las Vegas* (les effets aléatoires se déclenchent deux fois), *Tribunal* (les cartes Crimes et scandales –2), *Concert* (les cartes Musique donnent +1 à leurs alliés ici), *Serveur Discord* (les cartes Internet coûtent 1 de moins ici), *Le métro parisien* (cartes FR +2).
- **30 terrains au lancement**, + 5 par série mondiale, + 3 par série pays.

### 3.9 Équilibrage : budget de puissance
Puissance de référence d'une carte sans effet, par coût :

| Coût | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Puissance | 2 | 4 | 5 | 7 | 9 | 11 |

Chaque effet a une valeur en points de puissance (table `effect_costs`), soustraite de la référence. Un outil d'admin calcule le budget et signale les cartes hors norme. Ajustements ensuite à partir des statistiques de victoire (section 15).

---

## 4. Contenu : catégories et set de base

### 4.1 Les 10 catégories
| Catégorie (id) | Style de jeu | Cartes au lancement |
|---|---|---|
| Nuits et excès (`nuits_exces`) | Séduction, gros bonus puis malus | 24 |
| Crimes et scandales (`crimes_scandales`) | Vol, destruction, effets de fin de partie | 24 |
| Mystères et complots (`mysteres`) | Hasard, imprévus | 24 |
| Guerre et pouvoir (`guerre_pouvoir`) | Puissance brute, renforce les alliés | 24 |
| Sport (`sport`) | Élan | 24 |
| Musique (`musique`) | Renforce les cartes du même terrain | 24 |
| Séries et cinéma (`series_cinema`) | Copie, transformation | 24 |
| Internet et jeux vidéo (`internet`) | Viral, Ratio, Clickbait, Shitpost | 24 |
| Science et technologie (`science`) | Génère des cartes, combos | 24 |
| Exploration et extrêmes (`exploration`) | Croissance | 24 |
| Légendes (multi-catégories) | Cartes puissantes à 2 catégories | 10 |
| **Total** | | **250** |

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
Chaque catégorie doit permettre un deck jouable seule.

### 4.4 Mini-série « Industrie X » (dans Nuits et excès)
- 10 à 12 cartes au lancement : 6 à 8 actrices et acteurs (époques et pays variés) + institutions, films devenus phénomènes de société, magazines, cérémonies, lieux.
- Mécanique principale : **Séduction**.
- Flag `adult: true` → soumis au filtrage par pays (section 9).

### 4.5 Séries
- **Série mondiale** : 60 à 80 cartes toutes les **8 semaines**, thème d'époque ou de lieu touchant toutes les catégories (ex. Années 80, Rock'n'roll, Jeux olympiques, Hollywood, Grandes explorations, Rome antique). Ajoute 5 terrains + 1 mot-clé.
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

- + 3 terrains du pays ; les cartes d'un pays gagnent **+2 sur les terrains de leur pays**.
- Ordre prévu : États-Unis, Brésil, France, Mexique/Espagne, Allemagne, Royaume-Uni, Japon, Philippines, Italie, Pologne.
- **Vote communautaire** (Discord / en jeu) pour 5 à 10 cartes de chaque série pays avant sa sortie.
- **Lancement = événement « Coupe du monde d'internet »** d'une semaine : classement entre nations.

### 4.6 Critère de notoriété : chaque carte doit être connue de la majorité
Règle centrale : un joueur de 21–40 ans doit reconnaître **la grande majorité des cartes** sans chercher. Une carte que personne ne connaît ne crée ni attachement ni partage.

**Score de notoriété** (calculé par le pipeline, pondérations en config) :
- **Portée internationale** (30 %) : nombre d'éditions linguistiques de Wikipédia ayant un article (sitelinks Wikidata).
- **Popularité** (50 %) : vues cumulées sur 12 mois, toutes langues confondues (API Pageviews).
- **Pertinence générationnelle** (20 %) : part des vues sur les 5 dernières années et période d'activité. Les sujets actifs depuis 1990 sont favorisés ; un sujet historique doit être de tout premier plan pour passer (ex. Napoléon, Cléopâtre).

Chaque critère est converti en percentile, puis combiné en un score de 0 à 100.

**Seuils par type de série** (config) :
| Série | Exigence |
|---|---|
| Set de base | Score ≥ 90 **et** article dans au moins 40 langues |
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

**Exclusions strictes**
- Toute personne qui a été **mineure** pendant une partie de la carrière ou des faits concernés par la carte → exclue, sans exception. En cas de doute, exclure.
- **Victimes** de crimes, d'attentats, de catastrophes.
- Attentats récents, figures terroristes, organisations terroristes.
- Performeurs X ayant publiquement dénoncé avoir été contraints ou exploités.
- Personnes privées (sans notoriété publique documentée).

**Règles pour les personnes réelles**
- Uniquement des faits publics et documentés (article Wikipédia de référence).
- Textes factuels, ton décalé autorisé, **jamais dégradant ni diffamatoire**.
- Performeurs X : nom de scène, carrière, récompenses, impact culturel. Aucune description sexuelle.
- Les effets de jeu ne doivent pas tourner en dérision un crime réel ou ses victimes.

**Procédure de retrait**
- Formulaire public « Demande de retrait » (page dédiée + lien sur chaque fiche de carte).
- Traitement prioritaire : retrait ou anonymisation sous 72 h depuis l'outil d'admin (section 12).
- Une carte retirée : désactivée en jeu, remplacée dans les collections par une carte de même rareté ou compensée en essence (section 6).

---

## 6. Économie

### 6.1 Monnaies
| Monnaie | Gagnée en jeu | Achetable | Usage |
|---|---|---|---|
| Pièces | Oui | Non | Boosters standards, boutique quotidienne |
| Gemmes | Un peu (succès, pass) | Oui | Boosters premium, cosmétiques, pass |
| Essence | Recyclage des doublons | **Non** | Crafting de cartes au choix |
| Jetons de guilde | Activité de guilde | **Non** | Boutique de guilde |

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

### 6.3 Crafting
- Doublons au-delà de 1 exemplaire (ou 2 pour échanger) → recyclables en essence.
- Toute carte d'une série publiée peut être fabriquée avec de l'essence. Coûts par rareté : 20 / 50 / 150 / 500 / 1500 (config).
- Recyclage : 5 / 12 / 40 / 120 / 400 (config).

### 6.4 Trade-up
- **5 doublons de même rareté** → 1 carte aléatoire de la rareté supérieure, **non possédée** par le joueur si possible.
- **Trade-up ciblé** : 8 doublons → le joueur choisit la catégorie de la carte obtenue.
- Probabilités affichées. Aucun coût en monnaie : le trade-up n'est **jamais** alimenté par de l'argent réel ou des gemmes.
- Tirage côté serveur, enregistré (`trade_ups`).

### 6.5 Échanges entre joueurs
- Cartes uniquement, **1 contre 1, même rareté**.
- Entre membres d'une même guilde ou amis depuis plus de 3 jours.
- 5 échanges / jour ; cartes GOAT : 1 échange / semaine.
- Aucune monnaie, aucun objet dans un échange. Les CGU interdisent la vente de cartes ou de comptes contre de l'argent.
- Tableau d'échanges de guilde (« je cherche / je propose »).
- Détection d'abus : comptes multiples (appareil, IP, empreinte), flux d'échanges à sens unique → blocage et revue.

### 6.6 Monétisation
- **Gemmes** : 6 paliers de prix, prix régionaux (table `price_tiers` par pays).
- **Pass saisonnier** (28 jours) : piste gratuite, piste premium, piste deluxe (variantes exclusives).
- **Variantes cosmétiques** de cartes (même carte, même stats) : holographique, cadre animé, filtre « glitch », pixel, doré, négatif, VHS.
- **Cosmétiques** : dos de cartes, plateaux, avatars, titres, emotes.
- **Boutique quotidienne** : quelques cartes précises (contenu connu) en pièces ou gemmes.
- **Aucune carte sous licence officielle** et aucun avantage de jeu achetable hors boosters prévisualisés.

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
- Table `country_rules` : pour chaque pays, flags autorisés (`adult`, `politicallySensitive`, liste de cartes bloquées).
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
2. **Score de notoriété** (section 4.6) : sitelinks, vues sur 12 mois toutes langues (API Pageviews), part des vues sur 5 ans. Rejet automatique sous les seuils de la série visée.
3. **Pré-filtrage automatique** selon la politique de contenu (section 5) : date de naissance vs dates des faits, occupations à risque, mots-clés sensibles → marquage `needs_review`.
4. **Export d'une liste courte** (CSV + vue admin), triée par popularité et catégorie.
5. **Curation humaine** dans l'outil d'admin : sélection, catégorie(s), rareté.
6. **Génération des stats** à partir du budget de puissance (3.9) et d'une bibliothèque d'effets par catégorie ; ajustement manuel.
7. **Textes** : nom + texte d'ambiance (flavor) multilingues, relecture par un ambassadeur local.
8. **Images** : récupération Commons + filtre de licences + traitement (section 10).
9. **Validation finale** et publication dans une série (statut `draft` → `review` → `published`).

Fournir des commandes CLI : `pipeline extract --country FR`, `pipeline score`, `pipeline images --series fr_01`, `pipeline validate --series fr_01`.

---

## 12. Outil d'administration (`apps/admin`)

- Éditeur de cartes (stats, effets en DSL avec validation, textes, catégories, flags).
- Calculateur de budget de puissance + alertes.
- Gestion des séries, terrains, mots-clés, raretés.
- Gestion des images : remplacement, crédits, retrait en un clic.
- **File des demandes de retrait** avec horodatage et statut.
- Gestion de `country_rules` et des listes de cartes bloquées.
- Tableaux de bord d'équilibrage : taux de victoire, taux de jeu par carte et par terrain.
- Gestion de la boutique, des prix régionaux, du pass, des événements.
- Journal d'audit de toutes les actions admin.

---

## 13. Social et rétention

- **Guildes** (30 membres, 40 au niveau 10) : rôles chef / adjoints / membres, niveaux et bonus, demandes de cartes et dons, tableau d'échanges, tournoi de guilde hebdomadaire, amicaux, boutique de guilde en jetons. Chat : réactions et messages prédéfinis traduits ; chat libre optionnel avec filtre et signalement.
- **Amis** : code ami, amicaux, échanges, comparaison de collections.
- **Missions** quotidiennes et hebdomadaires (alimentent le pass).
- **Progression de collection** : chaque carte nouvelle et chaque partie font avancer une barre de récompenses.
- **Succès et titres**.
- **Partage** : génération d'un clip vertical (format 9:16) ou d'une image de fin de partie à partager en un tap.
- **Rappels de pause** optionnels après 2 h de jeu continu.

---

## 14. Paiement, âge et conformité

- **Âge** : date de naissance obligatoire à l'inscription, accès refusé avant 21 ans. CGU 21+.
- **Paiement** : interface `PaymentProvider` (`createCheckout`, `handleWebhook`, `refund`). Les produits ne sont crédités **que** via webhook serveur vérifié et idempotent (`provider_transaction_id` unique). Gestion des remboursements et rétrofacturations.
- ⚠️ Le choix du prestataire n'est pas arrêté : la présence de cartes liées à l'industrie X peut faire classer le site « adulte ». Prévoir l'implémentation sandbox d'un prestataire classique **et** la possibilité d'en brancher un spécialisé (CCBill, Segpay, Verotel) sans changer le reste du code.
- **RGPD** : consentement cookies, export et suppression des données.
- **Transparence** : probabilités affichées (aperçus, trade-up, boosters gratuits), historique d'achats, plafond de dépense personnel facultatif.
- À valider par un avocat spécialisé avant lancement : aperçus de boosters, trade-up, échanges, contenu adulte par pays.

---

## 15. Analytics

Événements : `signup`, `session_start`, `match_start`, `match_end` (deck, terrains, résultat, durée, Hype), `card_played`, `preview_viewed`, `preview_refreshed`, `booster_purchased`, `trade_up`, `trade_completed`, `craft`, `pass_purchase`, `share_clip`, `guild_join`, `takedown_request`, `card_info_opened`, `recognition_survey_answer`.

KPIs : rétention J1 / J7 / J30, parties par jour, durée moyenne de partie, conversion payante, ARPDAU, taux de victoire par carte (équilibrage), taux de consultation quotidienne des aperçus.

---

## 16. Modèle de données (PostgreSQL, simplifié)

```sql
users(id, created_at, birth_date, country, locale, email, auth_provider, status)
cards(id, wikidata_id, series_id, rarity, cost, power, categories TEXT[], keywords TEXT[],
      effects JSONB, names JSONB, flavor JSONB, flags JSONB, image_asset_id, status, version)
card_images(id, card_id, source_url, author, license, license_url, modified BOOLEAN,
            personality_warning BOOLEAN, r2_key, fallback BOOLEAN)
series(id, type /*base|world|country*/, country, name JSONB, release_at, status)
terrains(id, series_id, name JSONB, effect JSONB, favored_category, favored_country)
keywords(id, definition JSONB, effect JSONB)
country_rules(country, allow_adult, allow_political, blocked_card_ids TEXT[])
collections(user_id, card_id, quantity, variants JSONB)
decks(id, user_id, name, card_ids TEXT[], updated_at)
wallets(user_id, coins, gems, essence, guild_tokens)
booster_previews(user_id, booster_type, card_ids TEXT[], seed, generated_at, refresh_at)
trade_ups(id, user_id, input_card_ids TEXT[], target_category, output_card_id, seed, created_at)
trades(id, from_user, to_user, offered_card, requested_card, status, created_at, completed_at)
matches(id, mode, player_a, player_b, ghost BOOLEAN, terrains TEXT[], seed, actions JSONB,
        result, hype_level, created_at)
ranked(user_id, season_id, rank, points, country)
trending(date, card_id, score)
guilds(id, name, emblem JSONB, language, level, xp) / guild_members(guild_id, user_id, role, tokens)
guild_requests(id, guild_id, user_id, card_id, filled, expires_at)
passes(user_id, season_id, tier, points, claimed JSONB)
products(id, type, contents JSONB, active) / price_tiers(product_id, country, currency, amount)
transactions(id, user_id, product_id, provider, provider_transaction_id UNIQUE, amount,
             currency, status, created_at)
takedown_requests(id, card_id, requester_contact, reason, status, created_at, resolved_at)
admin_audit(id, admin_id, action, payload JSONB, created_at)
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
GET/POST /trades  POST /trades/:id/accept
GET  /trending
GET  /ranked/leaderboard?country=FR
GET  /shop  POST /shop/checkout  POST /webhooks/payment
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
- `packages/engine` : état de partie, tours simultanés, ordre de révélation, terrains, DSL d'effets, mots-clés, décompte, Hype.
- Tests unitaires exhaustifs (chaque mot-clé, chaque action, cas d'égalité, déterminisme avec seed).

### Phase 2 — Prototype jouable local
- Rendu PixiJS : plateau, main, pose, révélation animée, fin de partie.
- 40 cartes de test + 10 terrains en JSON. Partie contre une IA simple.

### Phase 3 — Serveur et comptes
- Fastify, PostgreSQL, comptes 21+, collections, decks, matchmaking WebSocket, mode fantôme, replays.

### Phase 4 — Pipeline de contenu et admin
- `tools/pipeline` (Wikidata, Pageviews, Commons, filtres de licences, traitement d'images, carte typographique de secours).
- `apps/admin` (éditeur, budget de puissance, retraits, country_rules).
- Production du set de base de 250 cartes.

### Phase 5 — Économie
- Monnaies, aperçus de boosters (verrouillage serveur, minuteur 24 h, renouvellement après achat), crafting, recyclage, trade-up, échanges, boutique quotidienne.
- `PaymentProvider` en sandbox, prix régionaux, webhooks.

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
