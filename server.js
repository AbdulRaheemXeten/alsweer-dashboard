const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ODOO_URL = 'https://alsweer-staging-2-32438275.dev.odoo.com';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all /odoo/* requests to Odoo, forwarding cookies for session
app.post('/odoo/*', async (req, res) => {
  const odooPath = req.path.replace('/odoo', '');
  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    // Forward session cookie from browser if present
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

    const response = await fetch(ODOO_URL + odooPath, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    // Forward Set-Cookie back to browser so session persists
    const setCookie = response.headers.raw()['set-cookie'];
    if (setCookie) {
      setCookie.forEach(c => res.append('Set-Cookie', c));
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// Serve dashboard for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Al Sweer Dashboard running on port ${PORT}`);
});
