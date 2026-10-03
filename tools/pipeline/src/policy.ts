import { POLICY } from './config.js';
import { yearOf } from './score.js';
import type { Candidate, PolicyStatus } from './types.js';

/**
 * Politique de contenu (section 5), appliquée automatiquement à chaque candidat.
 * - `excluded` : règle stricte vérifiable (mineur, terrorisme…). Jamais publiable.
 * - `needs_review` : doute → un humain tranche dans l'outil d'admin (en cas de doute, on exclut).
 * - `ok` : rien de détecté (la curation humaine reste obligatoire).
 * Les raisons sont des codes stables, lisibles dans l'admin.
 */
export function evaluatePolicy(c: Candidate, now = new Date()): { status: PolicyStatus; reasons: string[]; flags: NonNullable<Candidate['flags']> } {
  const excluded: string[] = [];
  const review: string[] = [];
  const flags: NonNullable<Candidate['flags']> = {};
  const isPerson = c.kind === 'person';

  // Seule une personne encore mineure aujourd'hui est exclue (marge d'un an : l'anniversaire n'est pas toujours connu).
  const birthYear = yearOf(c.birth);
  if (isPerson && birthYear !== null && now.getUTCFullYear() - birthYear < POLICY.majority + 1) excluded.push('minor_now');

  // Terrorisme, négation de la Shoah : plus d'exclusion automatique (décision du 2026-10-03), revue humaine
  // obligatoire et contenu sensible. Seuls les mineurs d'aujourd'hui restent exclus d'office.
  const sensitiveReview = (reason: string) => {
    review.push(reason);
    flags.sensitive = true;
  };
  for (const i of c.instanceOf) if (POLICY.excludedInstances[i]) sensitiveReview(`terrorism:${i}`);
  for (const x of c.convictedOf) if (POLICY.excludedConvictions[x]) sensitiveReview(`convicted_terrorism:${x}`);
  const allText = [...Object.values(c.labels), ...Object.values(c.descriptions)].join(' ');
  if (POLICY.excludedWords.test(allText)) sensitiveReview('terrorism_or_denial');

  // Victimes, condamnations, morts violentes : revue humaine.
  if (c.listedAsVictim) review.push('listed_as_victim');
  if (c.convictedOf.length) review.push('convicted');
  if (c.mannerOfDeath.some((m) => POLICY.violentDeath.includes(m))) review.push('violent_death');
  if (c.causeOfDeath.some((m) => POLICY.sensitiveCauses.includes(m))) {
    review.push('sensitive_death');
    flags.sensitive = true;
  }

  // Industrie X : drapeau adulte, vérifier qu'aucune exploitation n'a été dénoncée.
  if (c.occupations.some((o) => POLICY.adultOccupations.includes(o))) {
    flags.adult = true;
    flags.sensitive = true;
    review.push('adult_performer');
  }

  // Descriptions : mots sensibles (meurtre, victime, attentat…).
  const text = Object.values(c.descriptions).join(' ');
  if (POLICY.sensitiveWords.test(text)) {
    review.push('sensitive_words');
    flags.sensitive = true;
  }
  if (c.convictedOf.length || review.includes('violent_death')) flags.sensitive = true;

  if (c.occupations.some((o) => POLICY.politicalOccupations.includes(o))) flags.politicallySensitive = true;

  const status: PolicyStatus = excluded.length ? 'excluded' : review.length ? 'needs_review' : 'ok';
  // Sans doublon (ex. deux condamnations pour terrorisme).
  return { status, reasons: [...new Set([...excluded, ...review])], flags };
}
