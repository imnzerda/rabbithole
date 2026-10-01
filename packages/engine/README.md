# @rabbithole/engine

Moteur de règles de RABBIT HOLE : TypeScript pur, sans dépendance au rendu ni à Node, et déterministe.
Le même code tourne sur le serveur (qui fait foi) et sur le client (pour animer).

## Les règles en 30 secondes

1. Gagne **2 des 3 terrains** : aie plus de puissance que l'adversaire dessus.
2. **6 tours.** À chaque tour, tu as autant d'énergie que le numéro du tour.
3. Les deux joueurs jouent **en même temps**, puis tout est révélé.
4. Un nouveau terrain apparaît à chacun des 3 premiers tours. On ne joue que sur les terrains visibles. 4 cartes max par camp.
5. **Hype** : double l'enjeu tout de suite (une fois chacun, jusqu'à ×4). **Lâche** quand tu veux pour ne perdre que l'enjeu actuel.

Ces lignes sont générées par `rulesSummary(rules)` et suivent la config.

## Mots-clés : une phrase, un chiffre

Le texte est généré par `keywordText(rules, keyword, locale)`. Ce qui est écrit sur les cartes suit donc toujours les valeurs d'équilibrage.

| Mot-clé | Effet |
|---|---|
| **Viral** | Crée une copie de cette carte (−1) sur un autre terrain. |
| **Ratio** | La carte adverse la plus forte ici perd 3. |
| **Cancel** | La carte adverse la plus forte ici perd ses effets. |
| **Clickbait** | +4 jusqu'à la fin du tour suivant. |
| **Rickroll** | Envoie la carte adverse la plus forte ici sur un autre terrain. |
| **Shitpost** | Gagne entre +0 et +8 au hasard. |
| **Séduction** | Vole la carte adverse la plus faible ici. |
| **Élan** | +2 si jouée aux tours 1 à 3. |
| **Croissance** | +1 à la fin de chaque tour. |
| **Tendance** | +1 aujourd'hui : cette carte est en tendance (automatique). |

### Simplifications par rapport au cahier des charges

| Avant | Maintenant | Pourquoi |
|---|---|---|
| Clickbait affiche une **fausse** puissance | Vrai bonus temporaire, visible de tous | Un chiffre affiché ne ment jamais |
| Ratio : moitié de la puissance, **si** la carte est plus forte | −3, sans condition | Pas de calcul ni de condition |
| Rickroll et Cancel se recoupaient | Cancel = perd ses effets ; Rickroll = envoyée ailleurs | Deux effets bien distincts |
| Live (+1 début de tour) ≈ Croissance (+1 fin de tour) | Live fusionné dans Croissance | Un seul mot-clé pour une seule idée |
| Shitpost : 6 effets variés | +0 à +8 sur la carte elle-même | Hasard compris en une lecture |
| Hype : doublement au tour suivant + doublement caché au dernier tour, ×8 | Doublement immédiat, ×4 max | Aucune règle invisible |
| Pose possible sur un terrain encore caché | Seulement sur les terrains visibles | On joue sur ce qu'on voit |

Les anciennes règles restent réactivables par la config (`allowPlayOnUnrevealedTerrain`, `hype.autoDoubleFinalTurn`, `hype.maxStake`).

## API

```ts
const ctx = createContext({ cards, terrains, rules });       // catalogue + règles (DEFAULT_RULES si absent)
let { state, events } = createMatch(ctx, { seed, players: [{ id, deck }, { id, deck }] });

validatePlays(ctx, state, 0, { plays: [{ uid, terrain: 0 }] }); // [] si valide
({ state, events } = resolveTurn(ctx, state, [subA, subB]));    // tour simultané complet
({ state, events } = declareHype(ctx, state, 1));
({ state, events } = fold(ctx, state, 0));                      // « Lâcher »

getPlayerView(ctx, state, 0);  // ce qu'un joueur a le droit de voir (à envoyer au client)
keywordText(ctx.rules, 'ratio', 'fr');
```

- `state` est du JSON pur et n'est jamais modifié en place : chaque appel renvoie un nouvel état.
- `events` est le journal ordonné de ce qui s'est passé. Il sert aux animations PixiJS et aux replays.
- Pour rejouer une partie, il suffit de la seed, des decks et de la liste des actions.
- Le RNG (xoshiro128**) est dans l'état. Le serveur fournit la seed à partir de `crypto`.
- Toutes les valeurs d'équilibrage sont dans `RulesConfig` (`src/rules.ts`) et peuvent être surchargées par `mergeRules`.

## Détails de résolution

Ces choix ne concernent que le moteur. Le joueur n'a pas besoin de les connaître.

| Sujet | Choix retenu |
|---|---|
| Pioche | 3 cartes de départ + 1 pioche dès le tour 1. Main pleine (7) : la carte reste dans le deck. |
| Ordre de révélation | Les deux joueurs posent face cachée. Le joueur qui mène (terrains contrôlés, puis puissance totale) révèle d'abord, sinon tirage au sort annoncé au début du tour. |
| Ciblage | Seules les cartes révélées sont ciblables. Égalité « plus forte / plus faible » : la carte posée en premier. |
| `opposite_card` | La carte adverse au même rang de pose sur le terrain. |
| Copies (Viral, `copy`) | Révélées tout de suite, sans redéclencher « à la révélation » (pas de boucle Viral → Viral). |
| Vol / Séduction / Rickroll | Aucun effet s'il n'y a pas de place à l'arrivée (4 cartes max). |
| Las Vegas | `random_of`, `random_enemy_here` et Shitpost se déclenchent deux fois. |
| Tendance | Liste figée au lancement de la partie (`trendingCardIds`). |
| Puissance négative | Autorisée. |
| Effets continus | Limités à `add_power` avec des cibles déterministes, contrôlé par `validateCardDef`. |
| `hide` | Encore disponible dans le DSL, mais à éviter dans le set de base (information cachée). |

## Extensions du DSL (en plus du cahier des charges)

- Déclencheurs `start_of_turn` et `end_of_turn`.
- Conditions `count`, `turn`, `played_on_turn`, `hand_size`, `terrain_is`, `and` / `or` / `not`.
- Montants dynamiques : `{ type: 'count', zone, filter, multiplier, base }`.
- Filtres de cartes : catégories, pays, mots-clés, raretés, coût, ids, « posée ce tour ».
- Modificateurs de terrain : `power`, `cost`, `aura`, `elan_always`, `random_twice`, plus `favoredCountry`.

## Tests

`pnpm test` lance 108 tests :
- chaque mot-clé, chaque action, chaque cible ;
- les terrains d'exemple du cahier des charges ;
- tous les cas de décompte et d'égalité, Hype et Lâcher ;
- le déterminisme et le replay ;
- le glossaire généré depuis la config ;
- 300 parties aléatoires avec vérification des invariants (zones, max 4 cartes par terrain, main ≤ 7, enjeu plafonné).
