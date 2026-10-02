import { describe, expect, it } from 'vitest';
import { classifyLicense, parseImagePage, stripHtml } from '../src/commons.js';
import { SOURCES } from '../src/config.js';
import { sumDaily } from '../src/pageviews.js';
import { evaluatePolicy } from '../src/policy.js';
import { activeSince, percentiles, scoreRun } from '../src/score.js';
import { toCsv } from '../src/store.js';
import type { Candidate, RunFile } from '../src/types.js';
import { buildSourceQuery, parseEntity, wdDate, type WdEntity } from '../src/wikidata.js';

const NOW = new Date('2026-10-02T00:00:00Z');

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  qid: 'Q1',
  kind: 'person',
  categories: ['science'],
  sources: ['scientifique'],
  labels: { fr: 'Sujet', en: 'Subject' },
  descriptions: { fr: 'physicienne', en: 'physicist' },
  countries: ['FR'],
  instanceOf: ['Q5'],
  occupations: ['Q901'],
  birth: '1950-01-01',
  death: null,
  start: '1975-01-01',
  end: null,
  sitelinks: 80,
  wikis: { en: 'Subject', fr: 'Sujet' },
  image: 'Subject.jpg',
  convictedOf: [],
  mannerOfDeath: [],
  causeOfDeath: [],
  listedAsVictim: false,
  memberOf: [],
  ...over,
});

describe('Wikidata', () => {
  it('requête d’extraction : motif, filtre de langues, pays facultatif', () => {
    const source = SOURCES.find((s) => s.id === 'chanteur')!;
    const q = buildSourceQuery(source, 40, 150, null);
    expect(q).toContain('wdt:P106 wd:Q177220');
    expect(q).toContain('FILTER(?sl >= 40)');
    expect(q).toContain('LIMIT 150');
    expect(q).not.toContain('P27');
    expect(buildSourceQuery(source, 10, 50, 'Q142')).toContain('(wdt:P27|wdt:P17|wdt:P495) wd:Q142');
  });

  it('chaque source vise une catégorie du jeu et a un identifiant unique', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    const categories = new Set(SOURCES.map((s) => s.category));
    expect(categories.size).toBe(10);
  });

  it('dates Wikidata', () => {
    expect(wdDate({ time: '+1958-08-29T00:00:00Z' })).toBe('1958-08-29');
    expect(wdDate({ time: '+1990-00-00T00:00:00Z' })).toBe('1990-01-01');
    expect(wdDate({ time: '-0069-01-01T00:00:00Z' })).toBe('-0069-01-01');
    expect(wdDate(null)).toBeNull();
  });

  it('entité → candidat : libellés (dont « mul »), dates, pays, image, articles', () => {
    const snak = (value: unknown, rank = 'normal') => ({ mainsnak: { snaktype: 'value', datavalue: { value } }, rank });
    const e: WdEntity = {
      id: 'Q42',
      labels: { mul: { value: 'Douglas Adams' }, fr: { value: 'Douglas Adams (fr)' } },
      descriptions: { en: { value: 'English writer' } },
      sitelinks: { enwiki: { title: 'Douglas Adams' }, frwiki: { title: 'Douglas Adams' } },
      claims: {
        P31: [snak({ id: 'Q5' })],
        P106: [snak({ id: 'Q36180' }), snak({ id: 'Q999' }, 'deprecated')],
        P569: [snak({ time: '+1952-03-11T00:00:00Z' })],
        P570: [snak({ time: '+2001-05-11T00:00:00Z' })],
        P2031: [snak({ time: '+1974-00-00T00:00:00Z' })],
        P27: [snak({ id: 'Q145' })],
        P18: [snak('Douglas adams portrait cropped.jpg')],
      },
    };
    const p = parseEntity(e, 95);
    expect(p.labels.fr).toBe('Douglas Adams (fr)');
    expect(p.labels.en).toBe('Douglas Adams');
    expect(p.occupations).toEqual(['Q36180']);
    expect(p.birth).toBe('1952-03-11');
    expect(p.start).toBe('1974-01-01');
    expect(p.countryQids).toEqual(['Q145']);
    expect(p.image).toBe('Douglas adams portrait cropped.jpg');
    expect(p.wikis).toEqual({ en: 'Douglas Adams', fr: 'Douglas Adams' });
    expect(p.sitelinks).toBe(95);
  });
});

describe('notoriété', () => {
  it('percentiles : rang dans le lot, ex æquo au milieu', () => {
    expect(percentiles([10, 20, 30])).toEqual([0, 50, 100]);
    expect(percentiles([5, 5])).toEqual([50, 50]);
    expect(percentiles([7])).toEqual([100]);
  });

  it('vues : somme des jours, jours sans donnée comptés à zéro', () => {
    expect(sumDaily({ '2026-09-01': 5, '2026-09-02': null, '2026-09-03': 7 })).toBe(12);
    expect(sumDaily(undefined)).toBe(0);
  });

  it('pertinence générationnelle : actif depuis 1990', () => {
    expect(activeSince(candidate({ death: null }), 1990, NOW)).toBe(1);
    expect(activeSince(candidate({ death: '1960-01-01' }), 1990, NOW)).toBe(0);
    expect(activeSince(candidate({ kind: 'event', start: '2011-01-01' }), 1990, NOW)).toBe(1);
    expect(activeSince(candidate({ kind: 'concept', start: null, end: null }), 1990, NOW)).toBe(0.5);
  });

  it('score rangé par catégorie ; seuil de la série ; iconiques = top 1 %', () => {
    const list: Candidate[] = [];
    for (let i = 0; i < 100; i++) {
      list.push(candidate({ qid: `M${i}`, categories: ['musique'], sitelinks: 40 + i, views: { last60Days: 1000 * (i + 1), annualEstimate: 6000 * (i + 1), byLanguage: {} } }));
      list.push(candidate({ qid: `E${i}`, categories: ['exploration'], sitelinks: 40 + i, views: { last60Days: 10 * (i + 1), annualEstimate: 60 * (i + 1), byLanguage: {} } }));
    }
    const run: RunFile = { series: 't', seriesType: 'base', country: null, createdAt: '', updatedAt: '', steps: [], candidates: list };
    scoreRun(run, NOW);
    // Le meilleur explorateur est en tête de sa catégorie, même avec 100 fois moins de vues.
    expect(list.find((c) => c.qid === 'E99')!.score!.total).toBe(100);
    expect(list.find((c) => c.qid === 'M99')!.score!.total).toBe(100);
    expect(list.filter((c) => c.score!.meetsThreshold).length).toBe(20);
    expect(list.filter((c) => c.score!.iconic).length).toBeLessThanOrEqual(3);
    expect(list.find((c) => c.qid === 'M99')!.score!.iconic).toBe(true);
  });
});

describe('politique de contenu', () => {
  it('rien à signaler → ok (la curation humaine reste obligatoire)', () => {
    expect(evaluatePolicy(candidate(), NOW)).toEqual({ status: 'ok', reasons: [], flags: {} });
  });

  it('mineurs : seule une personne encore mineure aujourd’hui est exclue', () => {
    expect(evaluatePolicy(candidate({ birth: '2010-05-01', start: null }), NOW)).toMatchObject({ status: 'excluded', reasons: ['minor_now'] });
    // Carrière commencée à 14 ans, enfant acteur devenu adulte, début de carrière inconnu : rien à signaler.
    expect(evaluatePolicy(candidate({ birth: '1989-12-13', start: '2003-01-01', categories: ['musique'] }), NOW).status).toBe('ok');
    expect(evaluatePolicy(candidate({ birth: '1980-01-01', occupations: ['Q970153'] }), NOW).status).toBe('ok');
    expect(evaluatePolicy(candidate({ categories: ['sport'], start: null }), NOW).status).toBe('ok');
  });

  it('terrorisme exclu ; victimes, condamnations, morts violentes à revoir', () => {
    expect(evaluatePolicy(candidate({ kind: 'event', instanceOf: ['Q2223653'], birth: null }), NOW).status).toBe('excluded');
    expect(evaluatePolicy(candidate({ convictedOf: ['Q7283'] }), NOW).status).toBe('excluded');
    expect(evaluatePolicy(candidate({ listedAsVictim: true }), NOW).reasons).toEqual(['listed_as_victim']);
    const convicted = evaluatePolicy(candidate({ convictedOf: ['Q132821'] }), NOW);
    expect(convicted).toMatchObject({ status: 'needs_review', reasons: ['convicted'], flags: { sensitive: true } });
    expect(evaluatePolicy(candidate({ mannerOfDeath: ['Q149086'] }), NOW).reasons).toEqual(['violent_death']);
  });

  it('Industrie X : drapeau adulte et revue (exploitation dénoncée ?)', () => {
    const r = evaluatePolicy(candidate({ occupations: ['Q488111'], categories: ['nuits_exces'] }), NOW);
    expect(r.status).toBe('needs_review');
    expect(r.reasons).toContain('adult_performer');
    expect(r.flags).toMatchObject({ adult: true, sensitive: true });
  });

  it('mots sensibles dans les descriptions (FR et EN) → revue, contenu sensible', () => {
    expect(evaluatePolicy(candidate({ descriptions: { en: 'American serial killer' } }), NOW).reasons).toContain('sensitive_words');
    expect(evaluatePolicy(candidate({ descriptions: { fr: 'victime d’un attentat' } }), NOW).flags.sensitive).toBe(true);
  });

  it('personnalités politiques : drapeau pour le filtrage par pays', () => {
    expect(evaluatePolicy(candidate({ occupations: ['Q82955'] }), NOW).flags.politicallySensitive).toBe(true);
  });
});

describe('images Commons', () => {
  const meta = (license: string, short: string, extra: Record<string, string> = {}) => ({
    License: { value: license },
    LicenseShortName: { value: short },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])),
  });

  it('licences acceptées : domaine public, CC0, CC BY, CC BY-SA', () => {
    for (const [code, short] of [
      ['pd', 'Public domain'],
      ['cc0', 'CC0'],
      ['cc-by-2.0', 'CC BY 2.0'],
      ['cc-by-sa-4.0', 'CC BY-SA 4.0'],
      ['cc-by-sa-3.0-de', 'CC BY-SA 3.0 de'],
    ]) {
      expect(classifyLicense(meta(code!, short!)).accepted, short).toBe(true);
    }
  });

  it('licences refusées : NC, ND, non libre, GFDL seule, licence absente', () => {
    expect(classifyLicense(meta('cc-by-nc-2.0', 'CC BY-NC 2.0'))).toMatchObject({ accepted: false, reason: 'nc_nd_or_nonfree' });
    expect(classifyLicense(meta('cc-by-nd-4.0', 'CC BY-ND 4.0')).accepted).toBe(false);
    expect(classifyLicense(meta('', '', { NonFree: 'true' }))).toMatchObject({ accepted: false, reason: 'non_free' });
    expect(classifyLicense(meta('gfdl', 'GFDL'))).toMatchObject({ accepted: false, reason: 'license_not_allowed' });
    expect(classifyLicense({})).toMatchObject({ accepted: false, reason: 'no_license' });
  });

  it('crédit : auteur sans HTML, droits de la personnalité signalés', () => {
    expect(stripHtml('<a href="//commons.wikimedia.org/wiki/User:X">Jane&nbsp;Doe</a> &amp; co')).toBe('Jane Doe & co');
    const info = parseImagePage('A.jpg', {
      title: 'File:A.jpg',
      imageinfo: [
        {
          url: 'https://upload.wikimedia.org/a.jpg',
          thumburl: 'https://upload.wikimedia.org/thumb/a.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
          extmetadata: { ...meta('cc-by-sa-4.0', 'CC BY-SA 4.0'), Artist: { value: '<b>Jane Doe</b>' }, Restrictions: { value: 'personality' } },
        },
      ],
    });
    expect(info).toMatchObject({ author: 'Jane Doe', license: 'CC BY-SA 4.0', accepted: true, personalityRights: true });
    expect(parseImagePage('B.jpg', { title: 'File:B.jpg', missing: '' })).toBeNull();
  });
});

describe('export', () => {
  it('CSV trié par catégorie puis score, cellules échappées', () => {
    const csv = toCsv([
      candidate({ qid: 'Q2', categories: ['sport'], score: { total: 50, reach: 0, popularity: 0, generation: 0, iconic: false, meetsThreshold: false } }),
      candidate({ qid: 'Q3', categories: ['musique'], labels: { fr: 'Nom, avec virgule' }, score: { total: 90, reach: 0, popularity: 0, generation: 0, iconic: true, meetsThreshold: true } }),
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toMatch(/^qid,nom_fr,/);
    expect(lines[1]).toMatch(/^Q3,"Nom, avec virgule",/);
    expect(lines[2]).toMatch(/^Q2,/);
  });
});
