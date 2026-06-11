const express   = require('express');
const fetch     = require('node-fetch');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ODOO_URL = process.env.ODOO_URL || 'https://alsweer-staging-2-33390707.dev.odoo.com';

// Required for Render (sits behind a load balancer)
app.set('trust proxy', 1);

// Security headers — CSP disabled because index.html uses inline onclick handlers
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
}));

// Rate limiting — general
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Login rate limiter — strict
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Please wait 15 minutes.' } }
});

// Blocked paths — dangerous Odoo endpoints
const BLOCKED_PATHS = [
  '/web/database/manager',
  '/web/database/create',
  '/web/database/drop',
  '/web/database/backup',
  '/web/database/restore',
  '/web/database/duplicate',
  '/web/webclient/version_info',
  '/_odoo/support',
  '/web/tests',
];

// Proxy helper
async function odooPost(odooPath, body, cookieHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(ODOO_URL + odooPath, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

// Cookie security helper
function secureCookie(c) {
  return c
    .replace(/;\s*HttpOnly/gi, '')
    .replace(/;\s*SameSite=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, '')
    + '; HttpOnly; SameSite=Lax; Secure';
}

// DB name endpoint
app.get('/odoo/dbname', async (req, res) => {
  try {
    const { text } = await odooPost('/web/database/list', {
      jsonrpc: '2.0', method: 'call', id: 1, params: {}
    });
    res.json(JSON.parse(text));
  } catch(e) {
    const host = ODOO_URL.replace('https://', '').split('.')[0];
    res.json({ result: [host] });
  }
});

// Main proxy
app.post('/odoo/*', async (req, res) => {
  const odooPath = req.path.replace('/odoo', '');

  // Block dangerous paths
  if (BLOCKED_PATHS.some(b => odooPath.startsWith(b))) {
    return res.status(403).json({ error: { message: 'This endpoint is not allowed.' } });
  }

  // Apply strict rate limit on login
  if (odooPath.startsWith('/web/session/authenticate')) {
    await new Promise(resolve => loginLimiter(req, res, resolve));
    if (res.headersSent) return;
  }

  try {
    const { text, headers } = await odooPost(odooPath, req.body, req.headers.cookie);

    // Forward cookies with security flags
    const setCookie = headers.raw()['set-cookie'];
    if (setCookie) {
      setCookie.map(secureCookie).forEach(c => res.append('Set-Cookie', c));
    }

    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    try {
      res.json(JSON.parse(text));
    } catch(e) {
      res.status(502).json({ error: { message: 'Unexpected response from Odoo.' } });
    }
  } catch(err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: { message: 'Request timed out. Please try again.' } });
    }
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { message: 'Server error: ' + err.message } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Secure dashboard running on port ${PORT}`));
