// Routing Middleware — password-gates ONLY /demo-voice-agent.html.
//
// Nothing else on this site is touched: the matcher below restricts this
// to a single exact path, so the main marketing site, every other page,
// and the /api/create-web-call function are all unaffected. The dashboard
// (wa-aios.vercel.app) is a separate Vercel project entirely and this file
// has no reach into it at all.
//
// How it works:
//  - GET without a valid session cookie  -> serve an inline, branded
//    password page (no separate HTML file needed) instead of the real demo.
//  - POST with the password              -> compared against
//    process.env.DEMO_ACCESS_PASSWORD (a Vercel environment variable —
//    never committed to the repo, never sent to the browser). If correct,
//    sign a cookie and redirect back to the same URL (POST-redirect-GET),
//    so the browser's next request already carries the cookie.
//  - GET with a valid cookie             -> next() lets the request fall
//    through to the real static file, unmodified.
//
// The password is only ever read server-side via process.env — it is
// never embedded in any HTML/JS returned to the browser, and the signed
// cookie itself doesn't reveal it (HMAC, not the plaintext password).

import { next } from '@vercel/functions';

export const config = {
  matcher: '/demo-voice-agent.html',
};

const COOKIE_NAME = 'wa_demo_auth';
const SESSION_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function sign(secret, value) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeCookieValue(secret) {
  const exp = Date.now() + SESSION_SECONDS * 1000;
  const sig = await sign(secret, String(exp));
  return `${exp}.${sig}`;
}

async function isValidCookie(secret, cookieValue) {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;
  const expected = await sign(secret, expStr);
  return expected === sig;
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function passwordPage({ error, unconfigured } = {}) {
  const message = unconfigured
    ? '<div class="error">Demo access isn\'t configured yet.</div>'
    : error
    ? '<div class="error">Incorrect password. Try again.</div>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Access | Work Artificial</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    background:#000; color:#fff; min-height:100vh;
    display:flex; align-items:center; justify-content:center;
    font-family:'Switzer',-apple-system,BlinkMacSystemFont,sans-serif;
    padding:24px;
  }
  .card{ width:100%; max-width:340px; text-align:center; }
  .logo-dot{
    width:34px; height:34px; border-radius:50%; margin:0 auto 22px;
    background:#000; box-shadow:0 0 14px rgba(255,0,17,0.28), inset 0 0 0 1px rgba(255,255,255,0.1);
    position:relative;
  }
  .logo-dot::after{
    content:''; position:absolute; inset:11px; border-radius:50%;
    background:#ff0011; box-shadow:0 0 10px 2px rgba(255,0,17,0.6);
  }
  h1{ font-size:19px; font-weight:600; letter-spacing:-0.01em; margin-bottom:8px; }
  p.sub{ font-size:13.5px; color:rgba(255,255,255,0.45); margin-bottom:26px; }
  form{ display:flex; flex-direction:column; gap:12px; }
  input[type="password"]{
    width:100%; background:#0a0a0a; border:1px solid rgba(255,255,255,0.15);
    border-radius:10px; padding:13px 16px; color:#fff; font-size:14px;
    font-family:inherit; text-align:center; outline:none;
    transition:border-color .2s ease;
  }
  input[type="password"]:focus{ border-color:rgba(255,0,17,0.5); }
  button{
    background:#fff; color:#0a0a0a; border:none; border-radius:10px;
    padding:13px 16px; font-family:inherit; font-weight:600; font-size:14px;
    cursor:pointer; transition:opacity .15s ease, transform .15s ease;
  }
  button:hover{ opacity:.9; transform:translateY(-1px); }
  .error{ color:#ff4d5e; font-size:12.5px; margin-top:14px; }
  .back{ display:inline-block; margin-top:26px; color:rgba(255,255,255,0.35); font-size:12.5px; text-decoration:none; }
  .back:hover{ color:rgba(255,255,255,0.6); }
</style>
</head>
<body>
  <div class="card">
    <div class="logo-dot"></div>
    <h1>Demo access</h1>
    <p class="sub">Enter the password to continue.</p>
    <form method="POST">
      <input type="password" name="password" autofocus required autocomplete="current-password">
      <button type="submit">Continue</button>
    </form>
    ${message}
    <a href="/" class="back">&larr; Back to Work Artificial</a>
  </div>
</body>
</html>`;
}

export default async function middleware(request) {
  const secret = process.env.DEMO_ACCESS_PASSWORD;

  // Fail closed: if the password isn't set up in Vercel yet, never let the
  // real demo through — just show the gate with a clear "not configured"
  // note rather than silently exposing the page.
  if (!secret) {
    return new Response(passwordPage({ unconfigured: true }), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (request.method === 'POST') {
    let submitted = '';
    try {
      const form = await request.formData();
      submitted = String(form.get('password') || '');
    } catch (e) {
      submitted = '';
    }

    if (submitted && submitted === secret) {
      const cookieValue = await makeCookieValue(secret);
      const headers = new Headers();
      headers.set('Location', request.url);
      headers.set('Cache-Control', 'no-store');
      headers.set(
        'Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/demo-voice-agent.html; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`
      );
      return new Response(null, { status: 303, headers });
    }

    return new Response(passwordPage({ error: true }), {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const cookieValue = getCookie(request, COOKIE_NAME);
  const authed = await isValidCookie(secret, cookieValue);

  if (!authed) {
    return new Response(passwordPage(), {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Authenticated — let the request continue through to the real static file.
  return next();
}
