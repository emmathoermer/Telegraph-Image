// Site-wide lock. Everything except the public paths in utils/auth.js
// (image links, the Telegram webhook, the "blocked image" pages) requires the
// BASIC_USER / BASIC_PASS login. Logging in once on the home page also lets
// the browser send the same credentials with its /upload requests.
//
// If the credentials are not configured, pages stay open as before but
// /upload is refused, so an unconfigured deployment is never an open uploader.

import {
    authConfigured,
    hasValidCredentials,
    isPublicPath,
    unauthorizedResponse,
    uploadDisabledResponse,
} from './utils/auth.js';

async function siteLock(context) {
    const { request, env } = context;
    const { pathname } = new URL(request.url);

    if (isPublicPath(pathname)) {
        return context.next();
    }

    if (!authConfigured(env)) {
        if (pathname === '/upload' || pathname.startsWith('/upload/')) {
            return uploadDisabledResponse();
        }
        return context.next();
    }

    if (await hasValidCredentials(request, env)) {
        return context.next();
    }
    return unauthorizedResponse();
}

export const onRequest = [siteLock];
