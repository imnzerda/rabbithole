import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candidate, RunFile } from './types.js';

/** Fichiers de travail : `tools/pipeline/out/<série>.json` (et `.csv`), hors dépôt git. */

export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

const pathOf = (series: string, ext: 'json' | 'csv') => join(OUT_DIR, `${series.replace(/[^\w-]/g, '_')}.${ext}`);

export function loadRun(series: string): RunFile {
  const p = pathOf(series, 'json');
  if (!existsSync(p)) throw new Error(`Aucune extraction pour la série « ${series} » : lance d'abord « pipeline extract --series ${series} ».`);
  return JSON.parse(readFileSync(p, 'utf8')) as RunFile;
}

export function saveRun(run: RunFile, step: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  run.updatedAt = new Date().toISOString();
  if (!run.steps.includes(step)) run.steps.push(step);
  const p = pathOf(run.series, 'json');
  writeFileSync(p, JSON.stringify(run, null, 2));
  return p;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Liste courte (section 11, étape 4) : triée par catégorie puis par score. */
export function toCsv(candidates: Candidate[]): string {
  const header = ['qid', 'nom_fr', 'nom_en', 'categories', 'type', 'pays', 'langues', 'vues_12_mois', 'score', 'iconique', 'seuil', 'politique', 'raisons', 'image', 'licence', 'adulte', 'sensible', 'description'];
  const rows = [...candidates]
    .sort((a, b) => (a.categories[0] ?? '').localeCompare(b.categories[0] ?? '') || (b.score?.total ?? 0) - (a.score?.total ?? 0))
    .map((c) => [
      c.qid,
      c.labels.fr ?? '',
      c.labels.en ?? '',
      c.categories.join('|'),
      c.kind,
      c.countries.join('|'),
      c.sitelinks,
      c.views?.last12Months ?? '',
      c.score?.total ?? '',
      c.score?.iconic ? 'oui' : '',
      c.score?.meetsThreshold ? 'oui' : 'non',
      c.policy?.status ?? '',
      c.policy?.reasons.join('|') ?? '',
      c.imageInfo?.accepted ? c.imageInfo.file : '',
      c.imageInfo?.license ?? '',
      c.flags?.adult ? 'oui' : '',
      c.flags?.sensitive ? 'oui' : '',
      c.descriptions.fr ?? c.descriptions.en ?? '',
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function saveCsv(run: RunFile): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = pathOf(run.series, 'csv');
  // BOM : Excel ouvre le fichier en UTF-8 (accents).
  writeFileSync(p, `﻿${toCsv(run.candidates)}`);
  return p;
}
