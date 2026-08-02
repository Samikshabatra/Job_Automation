export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': 'job-pipeline/1.0', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json();
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': 'job-pipeline/1.0', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

/** Strips HTML tags and decodes the entities Greenhouse/Lever actually emit. */
export function htmlToText(html: string): string {
  return html
    // Decode entities first: Greenhouse's `content` field is HTML-escaped, so
    // tags arrive as `&lt;p&gt;` rather than literal `<p>`. Decoding must run
    // before tag-stripping or the escaped tags survive as literal text.
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCharCode(parseInt(d, 16)))
    .replace(/&amp;/g, '&')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
