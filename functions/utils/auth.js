// Shared Basic-auth helpers for the site-wide lock (functions/_middleware.js)
// and the upload endpoint. Credentials come from BASIC_USER / BASIC_PASS,
// the same pair the admin dashboard already uses.

export const AUTH_REALM = 'Telegraph-Image';

// Paths that must stay reachable without logging in:
// - /file/*: the image links themselves (embedded on other sites)
// - /api/telegram-webhook: called by Telegram, protected by its own secret
// - the two pages /file/* redirects to when an image is blocked
const PUBLIC_PREFIXES = ['/file/'];
const PUBLIC_EXACT = new Set([
    '/api/telegram-webhook',
    '/block-img',
    '/block-img.html',
    '/whitelist-on',
    '/whitelist-on.html',
    '/favicon.ico',
]);

export function isPublicPath(pathname) {
    if (PUBLIC_EXACT.has(pathname)) return true;
    return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function authConfigured(env) {
    return typeof env.BASIC_USER === 'string' && env.BASIC_USER !== ''
        && typeof env.BASIC_PASS === 'string' && env.BASIC_PASS !== '';
}

function parseBasic(header) {
    if (!header) return null;
    const space = header.indexOf(' ');
    if (space === -1) return null;
    const scheme = header.slice(0, space);
    const encoded = header.slice(space + 1).trim();
    if (scheme.toLowerCase() !== 'basic' || !encoded) return null;

    let decoded;
    try {
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        decoded = new TextDecoder().decode(bytes).normalize();
    } catch (e) {
        return null;
    }
    const colon = decoded.indexOf(':');
    if (colon === -1 || /[\0-\x1F\x7F]/.test(decoded)) return null;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

async function sha256(text) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compare digests so neither the length nor the content of the secret leaks
// through timing.
async function safeEqual(a, b) {
    const [da, db] = await Promise.all([sha256(a), sha256(b)]);
    if (crypto.subtle.timingSafeEqual) {
        return crypto.subtle.timingSafeEqual(da, db);
    }
    let diff = 0;
    for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
    return diff === 0;
}

export async function hasValidCredentials(request, env) {
    if (!authConfigured(env)) return false;
    const creds = parseBasic(request.headers.get('Authorization'));
    if (!creds) return false;
    const [userOk, passOk] = await Promise.all([
        safeEqual(creds.user, env.BASIC_USER),
        safeEqual(creds.pass, env.BASIC_PASS),
    ]);
    return userOk && passOk;
}

export function unauthorizedResponse() {
    return new Response('You need to login.', {
        status: 401,
        headers: {
            'WWW-Authenticate': `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
            'Content-Type': 'text/plain;charset=UTF-8',
            'Cache-Control': 'no-store',
        },
    });
}

export function uploadDisabledResponse() {
    return new Response(
        JSON.stringify({ error: 'Upload is disabled until BASIC_USER and BASIC_PASS are configured.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
}
