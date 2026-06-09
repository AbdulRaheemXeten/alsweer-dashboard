# Al Sweer Sales Dashboard

A live sales dashboard connected to your Odoo instance.
No API key needed — login with your normal Odoo credentials.

---

## Deploy to Render.com (FREE — 5 minutes)

### Step 1 — Create a free GitHub account
Go to https://github.com and sign up (free).

### Step 2 — Create a new repository
1. Click the **+** button → **New repository**
2. Name it: `alsweer-dashboard`
3. Set to **Public**
4. Click **Create repository**

### Step 3 — Upload these files
Upload all files from this folder to the repository:
- `server.js`
- `package.json`
- `public/index.html`

(Click "uploading an existing file" on the GitHub page)

### Step 4 — Deploy on Render.com
1. Go to https://render.com and sign up free (use GitHub login)
2. Click **New** → **Web Service**
3. Connect your GitHub repository `alsweer-dashboard`
4. Fill in:
   - **Name**: alsweer-dashboard
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
5. Click **Create Web Service**
6. Wait ~2 minutes for deploy

### Step 5 — Share the link!
Render gives you a URL like:
`https://alsweer-dashboard.onrender.com`

Share this with your colleagues. They just need their Odoo login.

---

## How it works

1. User opens the link and logs in with their Odoo credentials
2. The server forwards their request to Odoo (bypasses CORS)
3. All 21 companies and salespeople load automatically
4. Apply filters → live data loads from Odoo in seconds

## Notes
- Free Render tier sleeps after 15 mins of inactivity (first load may take ~30 sec to wake up)
- Upgrade to Render Starter ($7/month) for always-on
- No data is stored on the server — everything goes directly to/from Odoo
