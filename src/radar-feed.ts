export interface RadarFeedEntry {
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  raw: Record<string, unknown>;
}

const HTML_TAG_RE = /<[^>]+>/g;
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/gi;
const XML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeXmlText(value: string): string {
  const noCdata = value.replace(CDATA_RE, '$1');
  let text = noCdata;
  for (const [entity, plain] of Object.entries(XML_ENTITY_MAP)) {
    text = text.split(entity).join(plain);
  }
  return text;
}

function stripTags(value: string): string {
  return decodeXmlText(value).replace(HTML_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
}

function extractTagContent(block: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = block.match(re);
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

function parseTime(value: string | null): string | null {
  if (!value) return null;
  const ts = new Date(value.trim());
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
}

function parseRssEntries(xml: string): RadarFeedEntry[] {
  const entries: RadarFeedEntry[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = stripTags(extractTagContent(block, 'title') ?? '');
    const link =
      stripTags(extractTagContent(block, 'link') ?? '')
      || stripTags(extractTagContent(block, 'guid') ?? '');
    if (!title || !link) continue;

    const description =
      extractTagContent(block, 'description')
      ?? extractTagContent(block, 'content:encoded')
      ?? '';

    const publishedAt = parseTime(
      extractTagContent(block, 'pubDate')
      ?? extractTagContent(block, 'dc:date')
      ?? extractTagContent(block, 'published'),
    );

    entries.push({
      title,
      url: link,
      summary: stripTags(description).slice(0, 1200),
      publishedAt,
      raw: {
        kind: 'rss',
      },
    });
  }

  return entries;
}

function extractAtomLink(entryBlock: string): string | null {
  const linkTagRe = /<link\b([^>]*)\/?>(?:<\/link>)?/gi;
  let match: RegExpExecArray | null;
  let fallbackHref: string | null = null;

  while ((match = linkTagRe.exec(entryBlock)) !== null) {
    const attrs = match[1] ?? '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[2]?.trim() ?? '';
    if (!href) continue;
    if (!fallbackHref) fallbackHref = href;
    const relMatch = attrs.match(/\brel\s*=\s*(["'])(.*?)\1/i);
    const rel = relMatch?.[2]?.trim().toLowerCase() ?? '';
    if (!rel || rel === 'alternate') {
      return href;
    }
  }

  return fallbackHref;
}

function parseAtomEntries(xml: string): RadarFeedEntry[] {
  const entries: RadarFeedEntry[] = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = stripTags(extractTagContent(block, 'title') ?? '');
    const link = extractAtomLink(block) || stripTags(extractTagContent(block, 'id') ?? '');
    if (!title || !link) continue;

    const summary =
      extractTagContent(block, 'summary')
      ?? extractTagContent(block, 'content')
      ?? '';

    const publishedAt = parseTime(
      extractTagContent(block, 'published')
      ?? extractTagContent(block, 'updated'),
    );

    entries.push({
      title,
      url: stripTags(link),
      summary: stripTags(summary).slice(0, 1200),
      publishedAt,
      raw: {
        kind: 'atom',
      },
    });
  }

  return entries;
}

export function parseRadarFeedXml(xml: string): RadarFeedEntry[] {
  const trimmed = xml.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  if (lower.includes('<rss') || lower.includes('<rdf:rdf')) {
    return parseRssEntries(trimmed);
  }
  if (lower.includes('<feed')) {
    return parseAtomEntries(trimmed);
  }
  return [];
}

export function canonicalizeRadarUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  parsed.hash = '';

  const keptParams: Array<[string, string]> = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    const key = k.toLowerCase();
    if (key.startsWith('utm_')) continue;
    if (key === 'gclid' || key === 'fbclid') continue;
    keptParams.push([key, v]);
  }
  keptParams.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = '';
  for (const [k, v] of keptParams) {
    parsed.searchParams.append(k, v);
  }

  const host = parsed.host.toLowerCase();
  let pathname = parsed.pathname || '/';
  pathname = pathname === '/' ? '/' : pathname.replace(/\/+$/g, '');

  const query = parsed.searchParams.toString();
  return `${parsed.protocol}//${host}${pathname}${query ? `?${query}` : ''}`;
}

export async function fetchRadarFeedEntries(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<RadarFeedEntry[]> {
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 15000, 60000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'SoloMesh-Radar/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.text();
    const parsed = parseRadarFeedXml(body);
    if (parsed.length === 0) {
      throw new Error('No RSS/Atom entries parsed');
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
