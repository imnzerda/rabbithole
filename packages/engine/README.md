# @rabbithole/engine

Moteur de règles de RABBIT HOLE : TypeScript pur, sans dépendance au rendu ni à Node, et déterministe.
Le même code tourne sur le serveur (qui fait foi) et sur le client (pour animer).

Le duel s'inspire du **TCG One Piece** : Leader, Vies, énergie (Buzz), attaques, blocages, contres et Déclencheurs, en tour par tour. Les puissances sont divisées par 1000 (5 au lieu de 5000), et les marques propres à One Piece (« DON!! »…) ne sont pas reprises.

## Les règles en 1 minute

1. **Mets KO le Leader adverse** : retire-lui toutes ses Vies, puis touche-le une dernière fois.
2. **Chaque tour** : tes cartes se redressent, tu pioches 1 carte et tu gagnes 2 Buzz (10 au maximum).
3. **Dépense ton Buzz** pour jouer des Personnages et des Événements, ou **attache-le** à une carte (+1 de puissance pendant ton tour).
4. **Attaque** avec ton Leader ou tes Personnages. La cible est le Leader adverse ou un Personnage **épuisé**. L'attaque réussit si sa puissance est au moins égale à celle du défenseur.
5. **Quand on t'attaque** : bloque avec un **Bloqueur**, puis défausse des cartes **Contre** pour renforcer ta défense.
6. Chaque **Vie perdue** arrive dans ta main, sauf si tu actives son **Déclencheur**.
7. **Hype** : double l'enjeu (une fois chacun, jusqu'à ×4). **Lâche** quand tu veux pour ne perdre que l'enjeu actuel.

Ces lignes sont générées par `rulesSummary(rules)` et suivent la config.

## Mots-clés

Générés par `keywordText(rules, keyword, locale)`.

| Mot-clé | One Piece | Effet |
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
| **Tendance** | — | +1 aujourd'hui (automatique). |

## API

```ts
const ctx = createContext({ cards, rules });          // catalogue + règles (DEFAULT_RULES si absent)
let { state, events } = createMatch(ctx, {
  seed, players: [{ id, leader, deck }, { id, leader, deck }],
});

pendingDecision(state);                 // { player, kind: 'mulligan' | 'main' | 'block' | 'counter' | 'trigger' }
legalActions(ctx, state, player);       // ce que ce joueur peut faire maintenant
({ state, events } = applyAction(ctx, state, player, { type: 'attack', attacker, target }));

getPlayerView(ctx, state, player);      // ce qu'un joueur a le droit de voir (à envoyer au client)
chooseAction(ctx, state, player, rng);  // IA simple (prototype, futur mode fantôme)
cardText(ctx, def, 'fr');               // texte de la carte généré depuis le DSL
```

Actions d'un joueur (`GameAction`) : `mulligan`, `play`, `attach`, `attack`, `activate`, `end_turn`, `block`, `counter`, `trigger`, `hype`, `fold`. Toute action est validée par le moteur ; une action illégale lève une `EngineError`.

- `state` est du JSON pur et n'est jamais modifié en place : chaque appel renvoie un nouvel état.
- `events` est le journal ordonné de ce qui s'est passé. Il sert aux animations PixiJS et aux replays.
- Pour rejouer une partie, il suffit de la seed, des decks et de la liste des actions.
- Le RNG (xoshiro128**) est stocké dans l'état. Le serveur fournit la seed à partir de `crypto`.
- Toutes les valeurs d'équilibrage sont dans `RulesConfig` (`src/rules.ts`) : taille de deck, Buzz, mots-clés, Hype, limite de tours…

## Détails de résolution

| Sujet | Choix retenu |
|---|---|
| Deck | 1 Leader + 20 cartes, 2 exemplaires max, chaque carte partage une catégorie avec le Leader. |
| Mise en place | Main de 5, un mulligan (remélanger + repiocher), puis Vies = valeur du Leader, prises sur le dessus du deck. |
| Premier tour | Le premier joueur (tiré au sort) ne pioche pas et ne gagne qu'1 Buzz. Personne n'attaque pendant son tout premier tour. |
| Buzz | Réserve totale de 10. Le Buzz dépensé est épuisé et redevient actif au début de ton tour. Le Buzz non dépensé reste actif pendant le tour adverse : il sert à payer les Événements [Contre]. |
| Buzz attaché | +1 de puissance pendant le tour de son contrôleur ; il revient (épuisé) quand la carte quitte le jeu, actif au redressement. |
| Ciblage des effets | Automatique : « le plus fort », « le plus faible », « au hasard »… Égalité → la carte posée en premier. Seuls les Leaders et Personnages en jeu sont ciblables. |
| Défense | Pas de Bloqueur disponible → on passe directement au Contre ; pas de Contre possible → le combat se résout immédiatement. |
| Dégâts | Les Vies sont retirées une par une ; chaque Déclencheur révélé attend la décision de son propriétaire avant la suivante. |
| Fin de partie | Leader touché à 0 Vie ; pioche vide au moment de piocher ; garde-fou à 40 tours (plus de Vies gagne, sinon égalité). |
| Événements | Payés, mis à la défausse, puis résolus. [Principale] pendant ton tour, [Contre] pendant une attaque adverse. |
| Effets continus | Limités à `add_power` avec des cibles statiques (`self`, `my_leader`, `enemy_leader`, `allies`, `enemies`, `all_mine`) pour éviter toute dépendance circulaire. Contrôlé par `validateCardDef`. |

## Tests

`pnpm test` lance 68 tests :
- mise en place, mulligan, déroulement des tours, validation des decks ;
- combat (attaque, blocage, contres, Déclencheurs, Viral, Ratio, coup fatal) ;
- chaque mot-clé et chaque action du DSL, capacités de Leader, Hype et abandon ;
- vue joueur sans information cachée ;
- déterminisme et replay ;
- 300 parties aléatoires avec vérification des invariants (zones, 5 Personnages max, conservation du Buzz) ;
- force de l'IA (plus de 85 % de victoires contre un joueur aléatoire) ;
- textes générés.
