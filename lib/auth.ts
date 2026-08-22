import { getUserIdBySession } from './repository';

const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return { hash, salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await derive(password, fromHex(salt));
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

export const SESSION_COOKIE = 'bili_session';
const MAX_AGE = 30 * 24 * 60 * 60;

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`;
}

export async function getUser(request: Request): Promise<{ userId: string } | null> {
  const token = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  const userId = await getUserIdBySession(token);
  return userId ? { userId } : null;
}
