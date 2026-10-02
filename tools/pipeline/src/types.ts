import type { CategoryId } from '@rabbithole/engine';

/** Nature du sujet d'une carte. */
export type SubjectKind = 'person' | 'group' | 'event' | 'work' | 'concept' | 'place';

export type PolicyStatus = 'ok' | 'needs_review' | 'excluded';

/** Image libre trouvée sur Wikimedia Commons, avec son crédit (section 10). */
export interface ImageInfo {
  file: string;
  /** Page de description du fichier sur Commons. */
  filePage: string;
  url: string;
  thumbUrl: string | null;
  author: string;
  license: string;
  licenseUrl: string | null;
  /** Licence acceptée (domaine public, CC0, CC BY, CC BY-SA). */
  accepted: boolean;
  rejectReason?: string;
  /** Avertissement « droits de la personnalité » sur Commons. */
  personalityRights: boolean;
}

/**
 * Candidat à une carte : un sujet Wikidata enrichi étape par étape
 * (extraction → notoriété → politique de contenu → image).
 */
export interface Candidate {
  qid: string;
  kind: SubjectKind;
  /** Catégories suggérées par les sources qui l'ont trouvé (2 au plus retenues à la curation). */
  categories: CategoryId[];
  /** Sources (requêtes) qui l'ont trouvé. */
  sources: string[];
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  /** Pays (codes ISO 3166-1 alpha-2) : nationalité, pays, ou pays d'origine. */
  countries: string[];
  instanceOf: string[];
  occupations: string[];
  birth: string | null;
  death: string | null;
  /** Début de carrière (P2031), ou début de l'événement / de l'œuvre. */
  start: string | null;
  end: string | null;
  sitelinks: number;
  /** Titres des articles Wikipédia par langue (langues suivies pour les vues). */
  wikis: Record<string, string>;
  /** Fichier Commons de l'image principale (P18). */
  image: string | null;
  /** Données utiles à la politique de contenu. */
  convictedOf: string[];
  mannerOfDeath: string[];
  causeOfDeath: string[];
  listedAsVictim: boolean;
  memberOf: string[];

  /** Vues Wikipédia des 60 derniers jours (langues suivies), et estimation annuelle. */
  views?: { last60Days: number; annualEstimate: number; byLanguage: Record<string, number> };
  score?: { total: number; reach: number; popularity: number; generation: number; iconic: boolean; meetsThreshold: boolean };
  policy?: { status: PolicyStatus; reasons: string[] };
  flags?: { adult?: boolean; sensitive?: boolean; politicallySensitive?: boolean };
  imageInfo?: ImageInfo | null;
}

/** Fichier de travail d'une série : `out/<série>.json`. */
export interface RunFile {
  series: string;
  seriesType: 'base' | 'world' | 'country';
  country: string | null;
  createdAt: string;
  updatedAt: string;
  steps: string[];
  candidates: Candidate[];
}
