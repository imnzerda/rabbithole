# RABBIT HOLE

TCG (jeu de cartes à collectionner) jouable dans le navigateur, sur desktop et mobile, cœur de cible 21–40 ans (aucune restriction d'âge à l'inscription). Les cartes représentent des personnes, événements, lieux et phénomènes réels issus de Wikipédia / Wikidata. La culture internet est l'ADN du jeu.

- Duels **tour par tour inspirés du TCG One Piece** : un Leader (carte célèbre, 4-5 Vies) + 20 cartes, énergie « Buzz », attaques, Bloqueurs, Contres, Déclencheurs. On gagne en mettant KO le Leader adverse.
- Monétisation sans hasard à l'achat : boosters à contenu prévisualisé, pass, cosmétiques. Pas de pay-to-win.
- Accroche : *Fall into everything.*

**Cahier des charges complet : [rabbit-hole-spec.md](rabbit-hole-spec.md).**
**Avancement et prochaines étapes : [PROGRESS.md](PROGRESS.md).**

> Le duel a été **refondu le 2026-10-02 sur le modèle du TCG One Piece** (tour par tour, Leader, Vies), en gardant le principe « un mot-clé = une phrase avec un chiffre ». Les puissances sont divisées par 1000 et les marques One Piece (« DON!! »…) ne sont pas reprises. Le cahier des charges (section 3) est à jour ; les détails de résolution sont dans [packages/engine/README.md](packages/engine/README.md).

## Stack

Monorepo pnpm (`apps/web`, `apps/server`, `apps/admin`, `packages/engine`, `packages/shared`, `tools/pipeline`) :
- PixiJS v8 pour le rendu de jeu ; SvelteKit pour l'UI.
- Node.js + Fastify, avec WebSocket.
- PostgreSQL et Redis.
- Images sur Cloudflare R2.
- Tests : Vitest et Playwright.

```bash
pnpm install
pnpm dev         # serveur de jeu (:3000) + site (:5173) ; ouvrir http://localhost:5173
pnpm dev:lan     # idem, accessible depuis un téléphone du même Wi-Fi
pnpm test        # tests unitaires (moteur, contenu, serveur)
pnpm typecheck   # tsc / svelte-check strict sur tous les packages
pnpm test:e2e    # Playwright (lance le serveur de dev si besoin)
```

`apps/web` utilise TypeScript 5.9 : `svelte-check` a besoin de l'API JS que TypeScript 7 n'expose plus. Le reste du monorepo est en TypeScript 7.

## Règles non négociables

### Architecture
- **Serveur autoritaire.** Le serveur résout les parties, les tirages, l'économie, les achats, le trade-up et les échanges. Le client se contente d'afficher et d'animer.
- **Moteur déterministe** (`packages/engine`) : même état + mêmes actions + même seed = même résultat. Pas de `Math.random`, pas de `Date` dans le moteur. Le client peut simuler pour animer, mais c'est le serveur qui fait foi.
- **RNG serveur via `crypto`** pour tous les tirages. La seed est enregistrée pour l'audit.
- **Aucun tirage aléatoire côté client. Aucun crédit d'achat côté client.** Un achat n'est crédité que par un webhook serveur vérifié et idempotent (`provider_transaction_id` unique).
- **Équilibrage jamais codé en dur** : les valeurs vivent dans la config (`packages/engine/src/rules.ts`) ou en base.
- **TypeScript strict partout.** Aucune logique de jeu ou d'économie dans les composants d'UI.
- On teste le moteur avant d'écrire le rendu correspondant.

### Économie
- **Ne jamais implémenter de renouvellement payant des aperçus de boosters**, ni d'accélération payante du minuteur de 24 h.
- **Pas de booster à contenu caché en vente.** L'acheteur reçoit exactement l'aperçu. Seuls les boosters gratuits (récompenses) peuvent être aléatoires.
- Le trade-up et les échanges ne passent jamais par de l'argent réel ou des gemmes.
- Les probabilités sont toujours affichées : aperçus, trade-up, boosters gratuits.
- Aucun avantage de jeu achetable en dehors des boosters prévisualisés.

### Contenu
- Chaque carte passe la **politique de contenu** (section 5 du cahier des charges) avant publication. Exclusions strictes :
  - toute personne qui était mineure au moment des faits (en cas de doute, on exclut) ;
  - les victimes ;
  - le terrorisme ;
  - les personnes privées ;
  - les performeurs X ayant dénoncé une exploitation.
- Les textes sont décalés mais **jamais dégradants ni diffamatoires**, et aucune image n'est explicite.
- **Images libres uniquement** : domaine public, CC0, CC BY, CC BY-SA. Chaque image a un crédit enregistré. Les licences NC, ND et fair use sont refusées.
- Le contenu `adult` est filtré par pays (`country_rules`).
- **Aucune condition d'âge** à l'inscription (ni date de naissance, ni case 21+). À venir : un **système de signalement** et un **interrupteur « contenu sensible »** (on/off) par joueur.
- **Inscription protégée** : captcha invisible (Turnstile), pot de miel, débit limité par IP et sous-réseau, e-mails jetables et alias refusés, un compte par appareil (empreinte numérique, cookie d'appareil), SMS demandé en cas de risque (VPN, appareil vu ailleurs) avec un compte par numéro. Comptes partageant un appareil ou une IP signalés. IP, appareils et numéros stockés uniquement en empreinte salée.
- **Pas de kit de départ** : les joueurs construisent leur deck en ouvrant des boosters.

### Méthode de travail
- On avance **phase par phase** (section 19 du cahier des charges) et on **demande validation à la fin de chaque phase**.
- On met à jour [PROGRESS.md](PROGRESS.md) à chaque étape importante.
- On écrit en français : code commenté, docs, échanges.

## Repères dans le code

- [packages/engine/](packages/engine/) : moteur de règles, avec un README qui décrit l'API, les règles simplifiées et les choix de résolution.
  - `match.ts` : cycle de partie, actions (`applyAction`), combat, Vies, décisions (`pendingDecision`, `legalActions`).
  - `keywords.ts` : mots-clés à effet immédiat (Rickroll, Cancel, Séduction, Shitpost, Clickbait).
  - `actions.ts` : DSL d'effets.
  - `query.ts` : ciblage, filtres et conditions.
  - `power.ts` : calcul de la puissance.
  - `view.ts` : ce qu'un joueur voit (sans information cachée), avec ses actions légales.
  - `validate.ts` : validation des cartes et des decks.
  - `glossary.ts` : texte des mots-clés, des règles et des cartes, généré depuis la config et le DSL.
  - `ai.ts` : IA simple, qui ne lit que les informations publiques et sa propre main.
- `packages/engine/test/` : `fixtures.ts` contient un pool qui couvre tous les mots-clés ; `helpers.ts` fournit un bac à sable (`sandbox`, classe `Duel`) pour écrire des scénarios, et `playOut` pour simuler des parties.
- [packages/content/](packages/content/) : Leaders, cartes et decks en JSON (`data/prototype/`), chargés par `prototypeContext()`.
- [packages/shared/](packages/shared/) : types du protocole WebSocket et de l'API REST, partagés entre le serveur et le site.
- [apps/server/](apps/server/) : Fastify, PostgreSQL (PGlite en dev et en test), WebSocket.
  - `src/config.ts` : configuration par variables d'environnement (`DATABASE_URL`, `SIGNAL_SALT`, `TURNSTILE_*`, `SMS_MODE`, `TWILIO_*`, `PROXYCHECK_KEY`, `FINGERPRINT_STRICT`, `GHOST_DELAY_MS`…) et valeurs de l'économie (`DEFAULT_ECONOMY`).
  - `src/db/` : accès base (`pg` / PGlite) et migrations SQL.
  - `src/auth/` : comptes, Argon2, sessions  ; inscription protégée : `antiabuse.ts` (appareils, comptes liés), `guard.ts` (captcha, SMS, VPN, débit, e-mails jetables et alias), `phone.ts` (numéros), `signup.ts` (vérification par SMS). L'empreinte numérique est calculée par `apps/web/src/lib/fingerprint.ts`.
  - `src/economy/` : portefeuille, aperçus de boosters, boosters gratuits, recyclage, crafting, Leader de départ, pièces de fin de partie.
  - `src/decks/` : collection et decks (validation par le moteur et par la possession).
  - `src/match/` : `room.ts` (partie qui fait foi : vues, événements filtrés, minuteurs, fantôme), `service.ts` (matchmaking), `routes.ts` (`/ws`, historique, replays).
  - `test/` : tests REST (`inject`) et temps réel (client `ws`).
- [apps/web/](apps/web/) : SvelteKit + PixiJS.
  - `lib/match/client.ts` : interface `MatchClient`. L'UI ne voit que des vues et des événements.
  - `lib/match/` : `LocalMatch` (entraînement hors ligne), `OnlineMatch` et `Lobby` (serveur), `ReplayMatch` (relecture).
  - `lib/ui/Game.svelte` : affichage d'une partie, quelle qu'en soit la source.
  - `lib/api.ts`, `lib/session.svelte.ts` : API REST et session.
  - `lib/game/renderer.ts` : plateau, deux dispositions (`PORTRAIT` pour smartphone, `LANDSCAPE` pour PC, choisies selon la forme de l'écran), glisser-déposer, animation des événements.
  - `lib/ui/CardInfo.svelte` : contenu d'une carte, partagé par la fiche plein écran et l'aperçu au survol (PC).
  - `lib/game/card-sprite.ts` : design typographique des cartes.
  - `lib/ui/` : fiches (carte, règles, fin de partie) et `DecisionPanel` (mulligan, blocage, contres, Déclencheur).
  - `e2e/` : tests Playwright (exécutés sur smartphone et sur PC) et `shots.mjs` (captures de contrôle, `DEVICE=desktop` pour le format PC).
