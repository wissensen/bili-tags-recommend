import { getCloudflareContext } from '@opennextjs/cloudflare';

type RuntimeEnv = {
  DB?: D1DatabaseLike;
  VISITOR_COOKIE_SECRET?: string;
};

export type D1DatabaseLike = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
  batch(statements: unknown[]): Promise<unknown>;
};

const VISITOR_COOKIE = 'bili_visitor';

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  // OpenNext installs this marker for Worker requests and for `next dev`
  // after `initOpenNextCloudflareForDev()`. Plain `next start` does not.
  if (!(globalThis as Record<PropertyKey, unknown>)[Symbol.for('__cloudflare-context__')]) {
    return { VISITOR_COOKIE_SECRET: process.env.VISITOR_COOKIE_SECRET };
  }
  try {
    const context = await getCloudflareContext({ async: true });
    return context.env as RuntimeEnv;
  } catch {
    return {
      VISITOR_COOKIE_SECRET: process.env.VISITOR_COOKIE_SECRET,
    };
  }
}

export async function getDatabase() {
  const env = await getRuntimeEnv();
  return env.DB ?? null;
}

function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sign(ownerId: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ownerId))));
}

export async function getVisitor(request: Request) {
  const env = await getRuntimeEnv();
  const secret = env.VISITOR_COOKIE_SECRET || 'local-development-only';
  const cookie = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)`))?.[1];

  // 仅 HTTPS 请求才给 cookie 加 Secure；本地 http://localhost 下加 Secure 会被浏览器丢弃，
  // 导致后续请求认不出访客（upload/analysis 查不到自己的记录，报 404）。
  const secure = new URL(request.url).protocol === 'https:';

  if (cookie) {
    const [ownerId, signature] = cookie.split('.');
    if (ownerId && signature && signature === await sign(ownerId, secret)) return { ownerId, isNew: false, secure };
  }

  return { ownerId: crypto.randomUUID(), isNew: true, secure };
}

export async function setVisitorCookie(response: Response, ownerId: string, secure: boolean, secret?: string) {
  const actualSecret = secret || (await getRuntimeEnv()).VISITOR_COOKIE_SECRET || 'local-development-only';
  const signature = await sign(ownerId, actualSecret);
  const attributes = `Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=31536000`;
  response.headers.append('Set-Cookie', `${VISITOR_COOKIE}=${ownerId}.${signature}; ${attributes}`);
  return response;
}

export async function jsonWithVisitor(body: unknown, init: ResponseInit | undefined, visitor: { ownerId: string; isNew: boolean; secure: boolean }) {
  const { NextResponse } = await import('next/server');
  const response = NextResponse.json(body, init);
  if (visitor.isNew) await setVisitorCookie(response, visitor.ownerId, visitor.secure);
  return response;
}
