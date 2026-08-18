import type { CommonsMedia } from './studioTypes';

type ExtValue = { value?: string };
type CommonsPage = {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: {
      ImageDescription?: ExtValue;
      Artist?: ExtValue;
      LicenseShortName?: ExtValue;
      LicenseUrl?: ExtValue;
      Credit?: ExtValue;
    };
  }>;
};

function cleanHtml(value: string | undefined) {
  if (!value) return '';
  const doc = document.createElement('div');
  doc.innerHTML = value;
  return (doc.textContent || '').replace(/\s+/g, ' ').trim();
}

export async function searchCommonsMedia(query: string, limit = 6): Promise<CommonsMedia[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: query.trim(),
    gsrlimit: String(Math.max(1, Math.min(12, limit))),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
  if (!response.ok) throw new Error(`Wikimedia Commons respondeu ${response.status}.`);
  const payload = await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(payload.query?.pages ?? {});
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    const originalUrl = info?.url;
    const thumbUrl = info?.thumburl || originalUrl;
    if (!originalUrl || !thumbUrl) return [];
    const metadata = info.extmetadata;
    return [{
      id: String(page.pageid ?? crypto.randomUUID()),
      title: (page.title || 'Arquivo Wikimedia').replace(/^File:/, ''),
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
      thumbUrl,
      originalUrl,
      description: cleanHtml(metadata?.ImageDescription?.value),
      artist: cleanHtml(metadata?.Artist?.value || metadata?.Credit?.value),
      license: cleanHtml(metadata?.LicenseShortName?.value) || 'Ver licença no Commons',
      licenseUrl: metadata?.LicenseUrl?.value || info.descriptionurl || '',
    } satisfies CommonsMedia];
  });
}

export async function fetchMediaBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Não foi possível baixar o B-roll (${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('O arquivo de B-roll retornado não é uma imagem compatível.');
  return blob;
}
