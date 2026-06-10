// ─── SECURE SERVER.JS ────────────────────────────────────────────────────────
// Fixes applied:
//   1. Removed NODE_TLS_REJECT_UNAUTHORIZED = '0'  (SSL now properly verified)
//   2. Rate limiting on all routes + strict limit on login attempts
//   3. Security headers via helmet
//   4. Request size reduced (10mb → 1mb)
//   5. Blocks dangerous Odoo paths (db manager, admin, shell)
//   6. Strips internal Render/server headers from responses
//   7. Cookie security flags enforced (HttpOnly, SameSite, Secure)
//   8. Timeout on all Odoo requests (10 seconds)
//   9. Only allows whitelisted Odoo API paths
// ─────────────────────────────────────────────────────────────────────────────

const express     = require('express');
const fetch       = require('node-fetch');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const helmet      = require('helmet');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ODOO_URL = process.env.ODOO_URL || 'https://alsweer-staging-2-32438275.dev.odoo.com';

// ── 1. SECURITY HEADERS ───────────────────────────────────────────────────────
// Adds: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      connectSrc:  ["'self'"],
      imgSrc:      ["'self'", "data:"],
    }
  },
  frameguard: { action: 'deny' },   // X-Frame-Options: DENY (prevents clickjacking)
}));

// ── 2. RATE LIMITING ──────────────────────────────────────────────────────────

// General limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs:  15 * 60 * 1000,
  max:       100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: { message: 'Too many requests. Please wait and try again.' } }
});

// Strict login limit: 10 attempts per 15 minutes per IP
// Prevents brute-force password attacks
const loginLimiter = rateLimit({
  windowMs:  15 * 60 * 1000,
  max:       10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: { message: 'Too many login attempts. Please wait 15 minutes.' } }
});

app.use(generalLimiter);

// ── 3. BODY LIMIT ─────────────────────────────────────────────────────────────
// Reduced from 10mb to 1mb — dashboard only sends small JSON payloads
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 4. BLOCKED PATHS ──────────────────────────────────────────────────────────
// Blocks access to sensitive Odoo endpoints that should never be exposed
// NOTE: /web/database/list is allowed (needed for login), only block the rest
const BLOCKED_PATHS = [
  '/web/database/manager',
  '/web/database/create',
  '/web/database/drop',
  '/web/database/backup',
  '/web/database/restore',
  '/web/database/duplicate',
  '/odoo/action-base_setup',
  '/web/webclient/version_info',
  '/_odoo/support',
  '/web/tests',
  '/base_import',
];

// ── 5. ALLOWED ODOO API PATHS (whitelist) ─────────────────────────────────────
// Only these paths are allowed through — everything else is blocked
const ALLOWED_PATHS = [
  '/web/session/authenticate',
  '/web/session/destroy',
  '/web/session/get_session_info',
  '/web/dataset/call_kw',
  '/web/database/list',
  '/web/action/load',
];

// ── 6. HELPER: PROXY TO ODOO ──────────────────────────────────────────────────
async function odooPost(odooPath, body, cookieHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  // Timeout: cancel request if Odoo takes more than 10 seconds
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(ODOO_URL + odooPath, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal:  controller.signal,
      // SSL verification is now ON (no NODE_TLS_REJECT_UNAUTHORIZED bypass)
    });
    return { res, text: await res.text(), headers: res.headers };
  } finally {
    clearTimeout(timeout);
  }
}

// ── 7. SECURE COOKIE HELPER ───────────────────────────────────────────────────
// Forces HttpOnly + SameSite=Lax + Secure on all forwarded cookies
// NOTE: SameSite=Lax (not Strict) is required for Odoo session cookies to work
function secureCookie(cookieStr) {
  let c = cookieStr
    .replace(/;\s*HttpOnly/gi,  '')
    .replace(/;\s*SameSite=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, '');
  c += '; HttpOnly; SameSite=Lax; Secure';
  return c;
}

// ── 8. DB NAME ENDPOINT ───────────────────────────────────────────────────────
app.get('/odoo/dbname', async (req, res) => {
  try {
    const { text } = await odooPost('/web/database/list', {
      jsonrpc: '2.0', method: 'call', id: 1, params: {}
    });
    const json = JSON.parse(text);
    res.json(json);
  } catch(e) {
    const host = ODOO_URL.replace('https://','').split('.')[0];
    res.json({ result: [host] });
  }
});

// ── 9. MAIN PROXY ─────────────────────────────────────────────────────────────
app.post('/odoo/*', (req, res, next) => {
  const odooPath = req.path.replace('/odoo', '');

  // Block dangerous paths
  if (BLOCKED_PATHS.some(b => odooPath.startsWith(b))) {
    return res.status(403).json({ error: { message: 'This endpoint is not allowed.' } });
  }

  // Whitelist check — only allow known safe API paths
  if (!ALLOWED_PATHS.some(a => odooPath.startsWith(a))) {
    return res.status(403).json({ error: { message: 'This endpoint is not permitted.' } });
  }

  next();
}, async (req, res) => {
  const odooPath = req.path.replace('/odoo', '');

  // Extra strict rate limit on login endpoint
  if (odooPath === '/web/session/authenticate') {
    return loginLimiter(req, res, async () => {
      await proxyToOdoo(odooPath, req, res);
    });
  }

  await proxyToOdoo(odooPath, req, res);
});

async function proxyToOdoo(odooPath, req, res) {
  try {
    const { res: odooRes, text, headers } = await odooPost(
      odooPath, req.body, req.headers.cookie
    );

    // Forward session cookies with security flags enforced
    const setCookie = headers.raw()['set-cookie'];
    if (setCookie) {
      setCookie
        .map(secureCookie)
        .forEach(c => res.append('Set-Cookie', c));
    }

    // Strip server info headers
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch(e) {
      res.status(502).json({
        error: { message: 'Odoo returned an unexpected response.' }
      });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: { message: 'Odoo request timed out. Please try again.' } });
    }
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { message: 'Server error. Please try again.' } });
  }
}

// ── 10. CATCH ALL ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Secure dashboard running on port ${PORT}`));
