# Pipeline de création de cartes

Section 11 du cahier des charges. Le pipeline trouve des **candidats** (personnes, événements, lieux, œuvres) sur Wikidata, mesure leur notoriété, applique la politique de contenu et cherche une image libre. Il ne crée **aucune carte** : la curation, les stats et les textes se font dans l'outil d'administration.

```bash
pnpm --filter @rabbithole/pipeline pipeline all --series base_01                 # set de base, toutes catégories
pnpm --filter @rabbithole/pipeline pipeline all --series fr_01 --country FR      # série pays
pnpm --filter @rabbithole/pipeline pipeline extract --series essai --categories musique,sport --limit 30
pnpm --filter @rabbithole/pipeline pipeline validate --series base_01            # bilan
```

Les résultats vont dans `tools/pipeline/out/` (hors dépôt) : `<série>.json` (fichier de travail, importé ensuite dans l'admin) et `<série>.csv` (liste courte, ouvrable dans Excel).

## Étapes

| Commande | Étape | Source |
|---|---|---|
| `extract` | Sujets classés par nombre de langues, pour chaque source de chaque catégorie, puis leurs détails (libellés, dates, pays, occupations, image) | Wikidata (SPARQL + `wbgetentities`) |
| `score` | Vues des 12 et 60 derniers mois (10 langues), puis **score de notoriété** | API Pageviews |
| `policy` | **Politique de contenu** : `ok`, `needs_review` ou `excluded`, avec les raisons | Données Wikidata |
| `images` | Image principale, **licence vérifiée** et crédit complet | Wikimedia Commons |
| `export` | Liste courte en CSV, triée par catégorie puis score | — |
| `validate` | Bilan : statuts, seuils, images, sensibles, cartes utilisables par catégorie | — |
| `all` | Toutes les étapes | — |

Chaque étape reprend le fichier de la précédente ; `score` reprend les sujets dont les vues n'ont pas pu être lues (limite de débit de Wikimedia).

## Réglages (`src/config.ts`)

- **Sources** : une requête par type de sujet (occupation ou nature Wikidata), rattachée à une catégorie. Les identifiants ont été vérifiés via l'API. Les occupations trop ambiguës (pilote, marin, entrepreneur) sont écartées : ces sujets s'ajoutent à la main.
- **Seuils par série** : set de base ≥ 40 langues, série mondiale ≥ 25, série pays ≥ 10 ; score minimal 90 / 80 / 0.
- **Score de notoriété** : portée (sitelinks, 30 %), popularité (vues sur 12 mois, 50 %), pertinence générationnelle (actif depuis 1990 et tendance des vues, 20 %). Chaque critère devient un percentile **dans la catégorie principale** du sujet, puis le total pondéré est lui-même rangé : 90 = les 10 % les plus connus de la catégorie. Les **iconiques** (candidats GOAT) sont le top 1 % de tout le lot.
- **Licences** : domaine public, CC0, CC BY, CC BY-SA acceptés ; NC, ND, non libre, GFDL seule ou licence absente refusés.

## Politique de contenu (section 5)

| Règle | Résultat |
|---|---|
| Personne mineure aujourd'hui | `excluded` |
| Attaque ou organisation terroriste, condamnation pour terrorisme | `excluded` |
| Cité comme victime d'un événement, condamné, mort violente, overdose | `needs_review` (+ contenu sensible) |
| Actrice ou acteur X | `needs_review` + drapeau `adult` (vérifier qu'aucune exploitation n'a été dénoncée) |
| Mots sensibles dans la description (meurtre, victime, attentat…) | `needs_review` + contenu sensible |
| Personnalité politique | drapeau `politicallySensitive` (filtrage par pays) |

`ok` signifie seulement que rien n'a été détecté : chaque carte passe quand même par la curation humaine.

## Limites connues

- Les vues ne couvrent que 10 langues (`PAGEVIEW_LANGUAGES`) et commencent en juillet 2015.
- Les images ne sont pas encore recadrées, teintées ni envoyées sur R2 (section 10.3) : à faire quand le stockage sera configuré.
- Le test de reconnaissance par sondage (section 4.6) se fera en jeu, après la phase 6.
