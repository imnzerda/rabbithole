# Pipeline de création de cartes

Section 11 du cahier des charges. Le pipeline trouve des **candidats** (personnes, événements, lieux, œuvres) sur Wikidata, mesure leur notoriété, applique la politique de contenu et cherche une image libre. Il ne crée **aucune carte** : la curation, les stats et les textes se font dans l'outil d'administration.

```bash
pnpm --filter @rabbithole/pipeline pipeline all --series base_01                 # set de base, toutes catégories
pnpm --filter @rabbithole/pipeline pipeline all --series fr_01 --country FR      # série pays
pnpm --filter @rabbithole/pipeline pipeline extract --series essai --categories musique,sport --limit 30
pnpm --filter @rabbithole/pipeline pipeline validate --series base_01            # bilan
pnpm --filter @rabbithole/pipeline pipeline add --series base_01 --category mysteres --kind place --qids Q43708,Q177397
                                                                                  # ajout manuel de sujets
```

Les résultats vont dans `tools/pipeline/out/` (hors dépôt) : `<série>.json` (fichier de travail, importé ensuite dans l'admin) et `<série>.csv` (liste courte, ouvrable dans Excel).

## Étapes

| Commande | Étape | Source |
|---|---|---|
| `extract` | Sujets classés par nombre de langues, pour chaque source de chaque catégorie, puis leurs détails (libellés, dates, pays, occupations, image) | Wikidata (SPARQL + `wbgetentities`) |
| `score` | Vues des 60 derniers jours (10 langues, par lots de 50 articles), puis **score de notoriété** | API MediaWiki (PageViewInfo) |
| `policy` | **Politique de contenu** : `ok`, `needs_review` ou `excluded`, avec les raisons | Données Wikidata |
| `images` | Image principale, **licence vérifiée** et crédit complet | Wikimedia Commons |
| `export` | Liste courte en CSV, triée par catégorie puis score | — |
| `validate` | Bilan : statuts, seuils, images, sensibles, cartes utilisables par catégorie | — |
| `all` | Toutes les étapes | — |
| `add` | Ajout manuel de sujets par identifiant Wikidata (mèmes, lieux, sujets hors des sources), puis vues, score, politique et images | Wikidata, Commons |

Chaque étape reprend le fichier de la précédente ; `score` reprend les sujets dont les vues n'ont pas pu être lues (limite de débit de Wikimedia).

## Réglages (`src/config.ts`)

- **Sources** : une requête par type de sujet (occupation ou nature Wikidata), rattachée à une catégorie. Les identifiants ont été vérifiés via l'API. Les occupations trop ambiguës (pilote, marin, entrepreneur) sont écartées : ces sujets s'ajoutent à la main.
- **Seuils par série** : set de base ≥ 40 langues, série mondiale ≥ 25, série pays ≥ 10 ; score minimal 90 / 80 / 0.
- **Score de notoriété** : portée (sitelinks, 30 %), popularité (vues des 60 derniers jours extrapolées sur un an, 50 %), pertinence générationnelle (actif depuis 1990, 20 %). Chaque critère devient un percentile **dans la catégorie principale** du sujet, puis le total pondéré est lui-même rangé : 90 = les 10 % les plus connus de la catégorie. Les **iconiques** (candidats GOAT) sont le top 1 % de tout le lot.
- **Licences** : domaine public, CC0, CC BY, CC BY-SA acceptés ; NC, ND, non libre, GFDL seule ou licence absente refusés.

## Politique de contenu (section 5)

| Règle | Résultat |
|---|---|
| Personne mineure aujourd'hui | `excluded` |
| Attaque ou organisation terroriste, condamnation pour terrorisme, description évoquant le terrorisme ou la négation de la Shoah | `needs_review` + contenu sensible |
| Cité comme victime d'un événement, condamné, mort violente, overdose | `needs_review` (+ contenu sensible) |
| Actrice ou acteur X | `needs_review` + drapeau `adult` (vérifier qu'aucune exploitation n'a été dénoncée) |
| Mots sensibles dans la description (meurtre, victime, attentat…) | `needs_review` + contenu sensible |
| Personnalité politique | drapeau `politicallySensitive` (filtrage par pays) |

`ok` signifie seulement que rien n'a été détecté : chaque carte passe quand même par la curation humaine.

## Limites connues

- **Écart au cahier des charges** : les vues portent sur 60 jours, pas 12 mois, et la tendance sur 5 ans n'est pas mesurée. L'API « par article » (12 mois) n'accepte qu'un article par requête et refuse rapidement les requêtes (HTTP 429) : intenable pour des milliers de sujets. Un événement d'actualité peut donc gonfler un score ; la curation humaine corrige.
- Les vues ne couvrent que 10 langues (`PAGEVIEW_LANGUAGES`).
- Les images ne sont pas encore recadrées, teintées ni envoyées sur R2 (section 10.3) : à faire quand le stockage sera configuré.
- Le test de reconnaissance par sondage (section 4.6) se fera en jeu, après la phase 6.

## Lots de cartes et decks de référence

- `drafts/<lot>.json` : cartes en brouillon (`{ series, seriesInfo, cards }`), à importer dans l'admin (Cartes → Importer des brouillons). Le test `test/drafts.test.ts` vérifie chaque carte : valide pour le moteur, dans le budget de puissance, nom et texte d'ambiance en français et en anglais, identifiants uniques entre les lots.
- `decks/<série>.json` : decks de référence (un par Leader, 10 cartes en 2 exemplaires). Le test `test/balance.test.ts` les fait s'affronter par simulation IA contre IA (déterministe) : chaque deck doit gagner entre 35 % et 65 % de ses parties. Modifier une carte qui déséquilibre la série fait échouer le test.
