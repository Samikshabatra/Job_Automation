import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';
import type { InboxEmail } from './inbox.js';

/**
 * READ-ONLY. The tracker classifies mail; it never sends, replies, labels or
 * deletes. Requesting the narrowest scope means a leaked token cannot be used
 * to act as the user.
 */
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const CREDENTIALS_PATH = 'config/gmail_credentials.json';
const TOKEN_PATH = 'config/gmail_token.json';

export interface GmailAuthPaths {
  credentialsPath?: string;
  tokenPath?: string;
}

export class GmailAuthError extends Error {}

function loadOAuthClient(paths: GmailAuthPaths = {}) {
  const credentialsPath = paths.credentialsPath ?? CREDENTIALS_PATH;
  const tokenPath = paths.tokenPath ?? TOKEN_PATH;

  if (!existsSync(credentialsPath)) {
    throw new GmailAuthError(
      `Missing ${credentialsPath}. Create a Google Cloud OAuth client (Desktop app), `
      + 'download the JSON, and save it there. See docs/gmail-setup.md.',
    );
  }
  const raw = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const conf = raw.installed ?? raw.web;
  if (!conf) throw new GmailAuthError(`${credentialsPath} is not a Desktop-app OAuth client JSON.`);

  const client = new google.auth.OAuth2(
    conf.client_id, conf.client_secret,
    conf.redirect_uris?.[0] ?? 'http://localhost',
  );
  if (!existsSync(tokenPath)) {
    throw new GmailAuthError(
      `Missing ${tokenPath}. Run \`npm run gmail-auth\` once to authorise. See docs/gmail-setup.md.`,
    );
  }
  client.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));
  return client;
}

/** The consent URL to visit, for the one-time authorisation step. */
export function authUrl(paths: GmailAuthPaths = {}): string {
  const credentialsPath = paths.credentialsPath ?? CREDENTIALS_PATH;
  const raw = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const conf = raw.installed ?? raw.web;
  const client = new google.auth.OAuth2(
    conf.client_id, conf.client_secret, conf.redirect_uris?.[0] ?? 'http://localhost',
  );
  // `offline` so the refresh token survives; `consent` so it is re-issued even
  // if this account has authorised before, which is the usual reason a token
  // file ends up without one.
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function exchangeCode(code: string, paths: GmailAuthPaths = {}): Promise<void> {
  const credentialsPath = paths.credentialsPath ?? CREDENTIALS_PATH;
  const tokenPath = paths.tokenPath ?? TOKEN_PATH;
  const raw = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const conf = raw.installed ?? raw.web;
  const client = new google.auth.OAuth2(
    conf.client_id, conf.client_secret, conf.redirect_uris?.[0] ?? 'http://localhost',
  );
  const { tokens } = await client.getToken(code);
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
}

/** Decode one MIME part tree down to readable text. */
export function extractBody(payload: any): string {
  if (!payload) return '';
  const decode = (data?: string) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  // Fall back to HTML with tags stripped: many ATS mails are HTML-only, and a
  // classifier that never sees them would abstain on every one of them.
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decode(payload.body.data).replace(/<[^>]+>/g, ' ');
  }
  return '';
}

function header(headers: any[], name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Fetch recent mail. `sinceDays` keeps the window rolling and small; the
 * `gmail_msg_id` UNIQUE constraint is what makes overlapping windows safe.
 */
export async function fetchRecentEmails(sinceDays = 7, paths: GmailAuthPaths = {}): Promise<InboxEmail[]> {
  const auth = loadOAuthClient(paths);
  const gmail = google.gmail({ version: 'v1', auth });

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `newer_than:${sinceDays}d -in:chats -in:sent`,
    maxResults: 100,
  });

  const out: InboxEmail[] = [];
  for (const meta of list.data.messages ?? []) {
    if (!meta.id) continue;
    const msg = await gmail.users.messages.get({ userId: 'me', id: meta.id, format: 'full' });
    const headers = msg.data.payload?.headers ?? [];
    out.push({
      id: meta.id,
      threadId: msg.data.threadId ?? null,
      receivedAt: new Date(Number(msg.data.internalDate ?? Date.now())).toISOString(),
      from: header(headers, 'From'),
      subject: header(headers, 'Subject'),
      body: extractBody(msg.data.payload),
    });
  }
  return out;
}
