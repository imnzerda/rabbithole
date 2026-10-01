import { ACCEPTED_LICENSES, REJECTED_LICENSE_PARTS } from './config.js';
import { chunk, getJson } from './http.js';
import type { ImageInfo } from './types.js';

/** Images libres de Wikimedia Commons (section 10) : licence vérifiée, crédit complet. */

const API = 'https://commons.wikimedia.org/w/api.php';

type ExtMeta = Record<string, { value?: string } | undefined>;

/** Texte brut d'un champ HTML de Commons (auteur, crédit). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Licence acceptée : domaine public, CC0, CC BY, CC BY-SA (toutes versions).
 * Refusée : NC, ND, non libre, fair use, licence absente ou inconnue (GFDL seule, etc.).
 */
export function classifyLicense(meta: ExtMeta): { accepted: boolean; license: string; licenseUrl: string | null; reason?: string } {
  const code = (meta.License?.value ?? '').trim();
  const short = stripHtml(meta.LicenseShortName?.value ?? '');
  const licenseUrl = meta.LicenseUrl?.value ?? null;
  const license = short || code || 'inconnue';
  if (meta.NonFree?.value && meta.NonFree.value !== 'false') return { accepted: false, license, licenseUrl, reason: 'non_free' };
  if (!code && !short) return { accepted: false, license, licenseUrl, reason: 'no_license' };
  if (REJECTED_LICENSE_PARTS.test(code) || REJECTED_LICENSE_PARTS.test(short)) return { accepted: false, license, licenseUrl, reason: 'nc_nd_or_nonfree' };
  const ok = ACCEPTED_LICENSES.test(code) || ACCEPTED_LICENSES.test(short) || /^public domain$/i.test(short);
  return ok ? { accepted: true, license, licenseUrl } : { accepted: false, license, licenseUrl, reason: 'license_not_allowed' };
}

interface Page {
  title: string;
  missing?: string;
  imageinfo?: { url: string; thumburl?: string; descriptionurl: string; extmetadata?: ExtMeta }[];
}

export function parseImagePage(file: string, page: Page | undefined): ImageInfo | null {
  const info = page?.imageinfo?.[0];
  if (!page || page.missing !== undefined || !info) return null;
  const meta = info.extmetadata ?? {};
  const lic = classifyLicense(meta);
  const author = stripHtml(meta.Artist?.value ?? '') || stripHtml(meta.Credit?.value ?? '') || 'Auteur inconnu';
  const restrictions = (meta.Restrictions?.value ?? '').toLowerCase();
  return {
    file,
    filePage: info.descriptionurl,
    url: info.url,
    thumbUrl: info.thumburl ?? null,
    author,
    license: lic.license,
    licenseUrl: lic.licenseUrl,
    accepted: lic.accepted,
    ...(lic.reason ? { rejectReason: lic.reason } : {}),
    personalityRights: restrictions.includes('personality'),
  };
}

/** Métadonnées de plusieurs fichiers Commons (par lots de 50). */
export async function fetchImages(files: string[], width = 800): Promise<Map<string, ImageInfo | null>> {
  const out = new Map<string, ImageInfo | null>();
  for (const part of chunk([...new Set(files)], 50)) {
    const titles = part.map((f) => `File:${f}`);
    const url = `${API}?${new URLSearchParams({
      action: 'query',
      titles: titles.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(width),
      format: 'json',
      formatversion: '2',
    })}`;
    const json = await getJson<{ query?: { pages?: Page[]; normalized?: { from: string; to: string }[] } }>(url);
    const normalized = new Map((json.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const pages = new Map((json.query?.pages ?? []).map((p) => [p.title, p]));
    for (const f of part) {
      const title = normalized.get(`File:${f}`) ?? `File:${f}`;
      out.set(f, parseImagePage(f, pages.get(title)));
    }
  }
  return out;
}
