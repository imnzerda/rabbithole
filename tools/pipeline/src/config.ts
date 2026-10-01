import type { CategoryId } from '@rabbithole/engine';
import type { SubjectKind } from './types.js';

/**
 * Réglages du pipeline : jamais codés en dur ailleurs.
 * Identifiants Wikidata vérifiés le 2026-10-02 (libellés relus via l'API).
 */

export const USER_AGENT = 'RabbitHolePipeline/0.1 (https://github.com/imnzerda/rabbithole)';

/** Une requête d'extraction : un motif SPARQL sur `?item`, rattaché à une catégorie. */
export interface Source {
  id: string;
  category: CategoryId;
  kind: SubjectKind;
  /** Motif SPARQL qui lie `?item` (sans le filtre de notoriété, ajouté automatiquement). */
  pattern: string;
  /** Plancher de langues propre à la source (sinon celui de la série). */
  minSitelinks?: number;
}

const person = (id: string, category: CategoryId, occupation: string): Source => ({
  id,
  category,
  kind: 'person',
  pattern: `?item wdt:P31 wd:Q5 ; wdt:P106 wd:${occupation} .`,
});
const instance = (id: string, category: CategoryId, kind: SubjectKind, cls: string, withSubclasses = false): Source => ({
  id,
  category,
  kind,
  pattern: withSubclasses ? `?item wdt:P31/wdt:P279* wd:${cls} .` : `?item wdt:P31 wd:${cls} .`,
});

/** Sources par catégorie (section 4.1). */
export const SOURCES: Source[] = [
  // Nuits et excès
  person('socialite', 'nuits_exces', 'Q512314'),
  person('mannequin', 'nuits_exces', 'Q4610556'),
  instance('boite_de_nuit', 'nuits_exces', 'place', 'Q622425'),
  instance('festival_musique', 'nuits_exces', 'event', 'Q868557'),
  // Industrie X : toujours marquée `adult` et revue humaine (section 4.4).
  person('acteur_x', 'nuits_exces', 'Q488111'),
  // Crimes et scandales
  person('gangster', 'crimes_scandales', 'Q46961'),
  person('mafieux', 'crimes_scandales', 'Q1404030'),
  person('baron_drogue', 'crimes_scandales', 'Q2543769'),
  person('pirate', 'crimes_scandales', 'Q10729326'),
  instance('scandale', 'crimes_scandales', 'event', 'Q192909', true),
  instance('vol', 'crimes_scandales', 'event', 'Q53706', true),
  // Mystères et complots
  instance('theorie_complot', 'mysteres', 'concept', 'Q159535', true),
  instance('cryptide', 'mysteres', 'concept', 'Q772636', true),
  instance('ovni', 'mysteres', 'event', 'Q40728071', true),
  instance('cite_perdue', 'mysteres', 'place', 'Q2974842', true),
  person('complotiste', 'mysteres', 'Q19831149'),
  // Guerre et pouvoir
  { ...person('politique', 'guerre_pouvoir', 'Q82955'), minSitelinks: 80 },
  person('officier', 'guerre_pouvoir', 'Q189290'),
  instance('guerre', 'guerre_pouvoir', 'event', 'Q198', true),
  instance('bataille', 'guerre_pouvoir', 'event', 'Q178561', true),
  // Sport
  person('footballeur', 'sport', 'Q937857'),
  person('basketteur', 'sport', 'Q3665646'),
  person('tennis', 'sport', 'Q10833314'),
  person('boxeur', 'sport', 'Q11338576'),
  person('pilote_auto', 'sport', 'Q10349745'),
  person('athlete', 'sport', 'Q11513337'),
  person('nageur', 'sport', 'Q10843402'),
  person('cycliste', 'sport', 'Q2309784'),
  person('mma', 'sport', 'Q11607585'),
  person('echecs', 'sport', 'Q10873124'),
  // Musique
  person('chanteur', 'musique', 'Q177220'),
  person('rappeur', 'musique', 'Q2252262'),
  person('musicien', 'musique', 'Q639669'),
  instance('groupe', 'musique', 'group', 'Q215380', true),
  // Séries et cinéma
  person('acteur', 'series_cinema', 'Q33999'),
  person('realisateur', 'series_cinema', 'Q2526255'),
  instance('film', 'series_cinema', 'work', 'Q11424'),
  instance('serie', 'series_cinema', 'work', 'Q5398426'),
  // Internet et jeux vidéo
  { ...person('youtubeur', 'internet', 'Q17125263'), minSitelinks: 15 },
  { ...person('streamer', 'internet', 'Q57414145'), minSitelinks: 10 },
  { ...person('influenceur', 'internet', 'Q2906862'), minSitelinks: 15 },
  { ...person('joueur_pro', 'internet', 'Q4379701'), minSitelinks: 15 },
  { ...instance('meme', 'internet', 'concept', 'Q2927074', true), minSitelinks: 10 },
  { ...instance('video_virale', 'internet', 'work', 'Q1030329', true), minSitelinks: 10 },
  instance('jeu_video', 'internet', 'work', 'Q7889'),
  instance('site_web', 'internet', 'work', 'Q35127', true),
  instance('reseau_social', 'internet', 'work', 'Q3220391', true),
  // Science et technologie
  person('scientifique', 'science', 'Q901'),
  person('physicien', 'science', 'Q169470'),
  person('chimiste', 'science', 'Q593644'),
  person('mathematicien', 'science', 'Q170790'),
  person('informaticien', 'science', 'Q82594'),
  person('inventeur', 'science', 'Q205375'),
  // Pas d'« entrepreneur » : trop de personnalités sans lien avec la science (curation manuelle).
  // Exploration et extrêmes
  person('explorateur', 'exploration', 'Q11900058'),
  person('astronaute', 'exploration', 'Q11631'),
  person('alpiniste', 'exploration', 'Q9149093'),
  // Pas de « pilote » ni de « marin » : occupations secondaires de présidents et d'acteurs (curation manuelle).
];

/** Exigences de notoriété par type de série (section 4.6). */
export const SERIES_RULES = {
  base: { minSitelinks: 40, minScore: 90 },
  world: { minSitelinks: 25, minScore: 80 },
  country: { minSitelinks: 10, minScore: 0 },
} as const;

/** Nombre maximal de sujets par source et par extraction. */
export const PER_SOURCE_LIMIT = 150;

/**
 * Score de notoriété : pondérations (section 4.6). Chaque critère est un percentile (0-100) dans la catégorie
 * principale du sujet ; le score est le percentile du total pondéré dans cette catégorie (90 = 10 % les plus connus).
 */
export const SCORE_WEIGHTS = { reach: 0.3, popularity: 0.5, generation: 0.2 };
/** Les GOAT viennent des sujets les plus iconiques : top 1 % du score. */
export const ICONIC_PERCENTILE = 99;
/** Sujets actifs depuis cette année favorisés (pertinence générationnelle). */
export const GENERATION_YEAR = 1990;

/** Langues dont on additionne les vues (marchés de lancement et grandes éditions). */
export const PAGEVIEW_LANGUAGES = ['en', 'fr', 'es', 'pt', 'de', 'it', 'ja', 'pl', 'ru', 'zh'];
/** Libellés et descriptions récupérés (« mul » : libellé multilingue, souvent le seul pour les noms de personnes). */
export const LABEL_LANGUAGES = ['fr', 'en', 'es', 'pt', 'de', 'it', 'ja', 'pl', 'mul'];

/** Licences d'images acceptées (section 10.1). */
export const ACCEPTED_LICENSES = /^(pd|public domain|cc0|cc-by-\d|cc-by-sa-\d|cc by \d|cc by-sa \d|cc-by-\d\.\d|cc-by-sa-\d\.\d)/i;
export const REJECTED_LICENSE_PARTS = /\b(nc|nd)\b|non-?commercial|no ?deriv|fair ?use|non-?free/i;

/** Politique de contenu (section 5) : règles automatiques, un humain tranche les cas douteux. */
export const POLICY = {
  /** Âge de la majorité. */
  majority: 18,
  /**
   * Carrière commencée avant la majorité (chanteurs, sportifs, acteurs…) : `exclude` applique la règle
   * du cahier des charges à la lettre (section 5) ; `review` laisse un humain décider si la carte
   * ne porte que sur la période adulte. Les personnes mineures aujourd'hui et les enfants acteurs
   * restent exclus dans tous les cas.
   */
  minorCareerStart: 'exclude' as 'exclude' | 'review',
  /** Occupations exclues d'office. */
  excludedOccupations: { Q970153: 'enfant acteur' } as Record<string, string>,
  /** Natures exclues d'office (terrorisme). */
  excludedInstances: { Q2223653: 'attaque terroriste', Q17127659: 'organisation terroriste' } as Record<string, string>,
  /** Condamnations qui excluent (terrorisme). */
  excludedConvictions: { Q7283: 'terrorisme' } as Record<string, string>,
  /** Occupations contenu adulte : drapeau `adult`, revue (exploitation dénoncée ?). */
  adultOccupations: ['Q488111'],
  /** Occupations où les carrières commencent souvent enfant : début de carrière inconnu → revue. */
  childCareerCategories: ['musique', 'series_cinema', 'sport', 'internet'] as CategoryId[],
  /** Morts violentes (homicide, suicide) : revue (victime ?). */
  violentDeath: ['Q149086', 'Q10737', 'Q3882219'],
  /** Causes de décès sensibles (overdose) : contenu sensible. */
  sensitiveCauses: ['Q3505252'],
  /** Mots qui déclenchent une revue humaine dans les descriptions. */
  sensitiveWords:
    /\b(murder|killer|kill|terror|rape|abuse|massacre|genocide|suicide|victim|pedophil|paedophil|child porn|assassin|shooting|meurtr|tueur|viol\b|violée|abus|attentat|génocide|victime|pédophil|fusillade|assassin)/i,
  /** Professions politiques : drapeau `politicallySensitive` (filtrage par pays). */
  politicalOccupations: ['Q82955'],
};
