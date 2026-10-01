# Avancement

## Phase en cours

**Phase 2 — Prototype jouable local** : pas encore commencée. Elle démarre quand la phase 1 est validée.

| Phase | Statut |
|---|---|
| 1. Moteur de règles | ✅ Terminée, règles simplifiées, en attente de validation finale |
| 2. Prototype jouable local | ⏳ Prochaine |
| 3. Serveur et comptes | — |
| 4. Pipeline de contenu et admin | — |
| 5. Économie | — |
| 6. Rétention | — |
| 7. Social | — |
| 8. International et lancement | — |

## Journal

### 2026-10-01 — Phase 1 : moteur de règles

**Mise en place**
- Monorepo pnpm, TypeScript strict (`noUncheckedIndexedAccess`), Vitest. `git init` fait, aucun commit pour l'instant.

**`packages/engine`**
- Partie complète : création (decks mélangés selon la seed, terrains tirés au sort), tours simultanés (pose face cachée puis révélation ordonnée), décompte, Hype, Lâcher.
- Contraintes de jeu : terrains révélés aux tours 1, 2 et 3, 4 cartes max par camp et par terrain, main de 7 max, mana égal au numéro du tour.
- Le DSL d'effets complet du cahier des charges, avec en plus :
  - les déclencheurs `start_of_turn` et `end_of_turn` ;
  - des conditions combinables et des montants dynamiques ;
  - des filtres de cartes.
- Les 10 mots-clés et les modificateurs de terrain : Prohibition, Stade, Las Vegas, Tribunal, Concert, Serveur Discord, métro parisien.
- `getPlayerView` : ce qu'un joueur a le droit de voir.
- `validateCardDef`, `validateCatalog` et `validateDeck`, réutilisables par l'admin et le pipeline.
- Glossaire (`keywordText`, `rulesSummary`, FR/EN) généré depuis la config.
- État en JSON pur avec RNG seedé, ce qui permet le replay à partir de seed + decks + actions.

**Simplification des règles** (demandée pour rendre le jeu compréhensible par tous) :
- Clickbait devient un vrai bonus de +4, plus de fausse puissance.
- Ratio devient −3 sans condition.
- Rickroll envoie la carte adverse la plus forte sur un autre terrain.
- Cancel fait perdre ses effets à la carte adverse la plus forte qui en a.
- Live est fusionné dans Croissance.
- Shitpost donne entre +0 et +8 au hasard.
- Hype : doublement immédiat, ×4 max, plus de doublement caché au dernier tour.
- On ne pose que sur les terrains visibles.

Détails et justifications dans [packages/engine/README.md](packages/engine/README.md). Les anciennes règles restent réactivables par la config.

**Tests : 108, tous verts.** Ils couvrent :
- chaque mot-clé, action et cible ;
- les terrains, le décompte et les égalités, Hype et Lâcher ;
- le déterminisme et le replay, le glossaire ;
- 300 parties aléatoires avec vérification des invariants.

**Fichiers projet** : `rabbit-hole-spec.md` (cahier des charges, sections 3.1, 3.3, 3.4, 3.7 et 4.1 mises à jour avec les règles simplifiées), `CLAUDE.md`, `PROGRESS.md`. Premier commit git de la phase 1.

## Prochaines étapes

### Phase 2 — Prototype jouable local
1. `apps/web` : SvelteKit + PixiJS v8, qui consomme `@rabbithole/engine`.
2. **40 cartes de test + 10 terrains en JSON** (fictifs ou génériques pour l'instant). Chaque catégorie doit pouvoir former un deck jouable, en respectant la courbe de coût de la section 4.3.
3. Rendu : plateau à 3 terrains, main, glisser-déposer pour poser, bouton « Fin de tour », révélation animée pilotée par les `events` du moteur, écran de fin de partie.
4. Lisibilité :
   - le texte des mots-clés vient de `keywordText` ;
   - un appui long affiche la fiche de la carte ;
   - un écran « Règles en 30 secondes » s'appuie sur `rulesSummary`.
5. **IA simple** : pose gloutonne des cartes abordables vers les terrains disputés. Elle est réutilisable plus tard pour le mode fantôme.
6. Mobile d'abord (portrait), desktop ensuite.

### Questions ouvertes
- Faut-il réduire encore les mots-clés du set de base (de 10 à 6–7, par exemple en retirant Séduction et Shitpost) ?
