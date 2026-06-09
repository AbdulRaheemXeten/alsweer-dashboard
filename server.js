process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ODOO_URL = 'https://alsweer-staging-2-32438275.dev.odoo.com';

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: proxy a POST to Odoo
async function odooPost(path, body, cookieHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  const res = await fetch(ODOO_URL + path, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  return { res, text: await res.text(), headers: res.headers };
}

// Get database name
app.get('/odoo/dbname', async (req, res) => {
  try {
    const { text } = await odooPost('/web/database/list', {
      jsonrpc: '2.0', method: 'call', id: 1, params: {}
    });
    const json = JSON.parse(text);
    res.json(json);
  } catch(e) {
    // If database list is disabled, return the hostname-based db name
    const host = 'alsweer-staging-2-32438275';
    res.json({ result: [host] });
  }
});

// Proxy all /odoo/* requests
app.post('/odoo/*', async (req, res) => {
  const odooPath = req.path.replace('/odoo', '');
  try {
    const { res: odooRes, text, headers } = await odooPost(
      odooPath, req.body, req.headers.cookie
    );

    // Forward session cookies
    const setCookie = headers.raw()['set-cookie'];
    if (setCookie) setCookie.forEach(c => res.append('Set-Cookie', c));

    // Try to parse as JSON, if HTML then Odoo rejected it
    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch(e) {
      res.status(502).json({
        error: { message: 'Odoo returned unexpected response. Check credentials or database name.' }
      });
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
