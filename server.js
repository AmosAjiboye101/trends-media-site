require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const sqliteDb = new Database(path.join(__dirname, 'data.db'));
const postgresPool = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL })
  : null;

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const initialHash = bcrypt.hashSync(adminPassword, 10);

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    business TEXT,
    service TEXT,
    message TEXT,
    source TEXT DEFAULT 'website',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    business TEXT,
    service TEXT,
    message TEXT,
    source TEXT DEFAULT 'website',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

function ensureSQLite() {
  sqliteDb.exec(sqliteSchema);
  sqliteDb.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)').run(adminUsername, initialHash);
}

async function ensureHostedSchema() {
  if (!postgresPool) return;
  await postgresPool.query(postgresSchema);
  await postgresPool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING', [adminUsername, initialHash]);
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return 'No data available';
  const headers = Object.keys(rows[0]);
  const escapeValue = (value) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeValue(row[header])).join(','));
  });
  return lines.join('\n');
}

async function fetchUsers() {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT * FROM users ORDER BY id DESC');
    return result.rows;
  }
  return sqliteDb.prepare('SELECT * FROM users ORDER BY id DESC').all();
}

async function getUserByUsername(username) {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  }
  return sqliteDb.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
}

async function getAllEnquiries() {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT * FROM enquiries ORDER BY id DESC');
    return result.rows;
  }
  return sqliteDb.prepare('SELECT * FROM enquiries ORDER BY id DESC').all();
}

async function getAllPayments() {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT * FROM payments ORDER BY id DESC');
    return result.rows;
  }
  return sqliteDb.prepare('SELECT * FROM payments ORDER BY id DESC').all();
}

async function getAllVisits() {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT * FROM visits ORDER BY id DESC');
    return result.rows;
  }
  return sqliteDb.prepare('SELECT * FROM visits ORDER BY id DESC').all();
}

async function insertEnquiry(payload) {
  const { name, email, phone, business, service, message } = payload || {};
  if (postgresPool) {
    const result = await postgresPool.query(
      'INSERT INTO enquiries (name, email, phone, business, service, message, source) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [name, email, phone || '', business || '', service || '', message || '', 'website']
    );
    return { id: result.rows[0].id };
  }
  const insert = sqliteDb.prepare(`
    INSERT INTO enquiries (name, email, phone, business, service, message, source)
    VALUES (?, ?, ?, ?, ?, ?, 'website')
  `);
  const result = insert.run(name, email, phone || '', business || '', service || '', message || '');
  return { id: result.lastInsertRowid };
}

async function insertPayment(payload) {
  const { customer_name, email, plan, amount, reference, status } = payload || {};
  if (postgresPool) {
    const result = await postgresPool.query(
      'INSERT INTO payments (customer_name, email, plan, amount, reference, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [customer_name, email, plan, Number(amount || 0), reference, status || 'paid']
    );
    return { id: result.rows[0].id };
  }
  const insert = sqliteDb.prepare(`
    INSERT INTO payments (customer_name, email, plan, amount, reference, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(customer_name, email, plan, Number(amount || 0), reference, status || 'paid');
  return { id: result.lastInsertRowid };
}

async function insertVisit(path, userAgent, ipAddress) {
  if (postgresPool) {
    await postgresPool.query('INSERT INTO visits (path, user_agent, ip_address) VALUES ($1, $2, $3)', [path, userAgent, ipAddress]);
    return;
  }
  sqliteDb.prepare('INSERT INTO visits (path, user_agent, ip_address) VALUES (?, ?, ?)').run(path, userAgent, ipAddress);
}

ensureSQLite();
ensureHostedSchema().catch((error) => {
  console.error('Hosted database initialization failed:', error.message);
});

function createApp() {
  const app = express();
  const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'https://trendsmedia.com,https://www.trendsmedia.com')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'cmc-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
    })
  );
  if (process.env.SERVE_FRONTEND !== 'false') {
    app.use(express.static(__dirname));
  }

  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'cmc-admin', message: 'Backend is running.' });
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/admin/login' || req.path === '/admin') {
      next();
      return;
    }

    if (req.session && req.session.authenticated) {
      next();
      return;
    }

    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'cmc-admin', backend: postgresPool ? 'postgres' : 'sqlite' });
  });

  app.get('/api/traffic', async (_req, res) => {
    const rows = await getAllVisits();
    const totalVisits = rows.length;
    const recentVisits = rows.slice(0, 10).map((visit) => ({
      path: visit.path,
      created_at: visit.created_at
    }));
    res.json({ totalVisits, recentVisits });
  });

  app.get('/api/enquiries', async (_req, res) => {
    const rows = await getAllEnquiries();
    res.json(rows);
  });

  app.get('/api/payments', async (_req, res) => {
    const rows = await getAllPayments();
    res.json(rows);
  });

  app.post('/api/track-visit', (req, res) => {
    const path = (req.body && req.body.path) || req.query.path || '/';
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    insertVisit(path, userAgent, ipAddress).then(() => {
      res.json({ ok: true });
    }).catch(() => {
      res.status(500).json({ error: 'Unable to record traffic' });
    });
  });

  app.post('/api/enquiry', async (req, res) => {
    const { name, email, phone, business, service, message } = req.body || {};

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    const result = await insertEnquiry({ name, email, phone, business, service, message });
    res.status(201).json({ ok: true, id: result.id });
  });

  app.post('/api/payment', async (req, res) => {
    const { customer_name, email, plan, amount, reference, status } = req.body || {};

    if (!customer_name || !email || !plan || !reference) {
      res.status(400).json({ error: 'Missing payment details.' });
      return;
    }

    const result = await insertPayment({ customer_name, email, plan, amount, reference, status });
    res.status(201).json({ ok: true, id: result.id });
  });

  app.get('/admin/login', (req, res) => {
    if (req.session && req.session.authenticated) {
      res.redirect('/admin');
      return;
    }

    res.send(`<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>CMC Admin Login</title>
        <style>
          :root { --ink: #171717; --paper: #f5f2eb; --panel: #ffffff; --line: #d9d4ca; --accent: #eb6537; --sage: #cadb45; }
          * { box-sizing: border-box; }
          body { margin:0; min-height:100vh; display:grid; place-items:center; background:linear-gradient(135deg, var(--paper), #efe9df); font-family: Arial, sans-serif; color: var(--ink); }
          .shell { width:min(440px, 92vw); background:var(--panel); border:1px solid var(--line); box-shadow:12px 12px 0 #171717; padding:30px 28px; }
          .eyebrow { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:700; }
          h1 { margin:12px 0 18px; font-size:36px; }
          label { display:block; margin-bottom:18px; font-size:13px; font-weight:700; }
          input { width:100%; padding:13px 14px; margin-top:8px; border:1px solid #999; font-size:15px; }
          .submit { width:100%; border:0; background:var(--ink); color:#fff; padding:14px 18px; font-weight:800; cursor:pointer; }
          .submit:hover { background:var(--accent); }
          .meta { margin-top:16px; font-size:12px; color:#555; }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="eyebrow">Trends Media Consult</div>
          <h1>Admin login</h1>
          <form method="POST" action="/admin/login">
            <label>
              Username
              <input name="username" required />
            </label>
            <label>
              Password
              <input type="password" name="password" required />
            </label>
            <button class="submit" type="submit">Log in</button>
          </form>
          <div class="meta">Default login: admin / admin123</div>
        </div>
      </body>
      </html>`);
  });

  app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = await getUserByUsername(username);

    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      res.status(401).send('Invalid credentials');
      return;
    }

    req.session.authenticated = true;
    req.session.username = user.username;
    res.redirect('/admin');
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  app.get('/admin/export/enquiries.csv', async (req, res) => {
    if (!req.session || !req.session.authenticated) {
      res.redirect('/admin/login');
      return;
    }

    const rows = await getAllEnquiries();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="enquiries.csv"');
    res.send(toCsv(rows));
  });

  app.get('/admin/export/payments.csv', async (req, res) => {
    if (!req.session || !req.session.authenticated) {
      res.redirect('/admin/login');
      return;
    }

    const rows = await getAllPayments();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send(toCsv(rows));
  });

  app.get('/admin', async (req, res) => {
    if (!req.session || !req.session.authenticated) {
      res.redirect('/admin/login');
      return;
    }

    const enquiries = await getAllEnquiries();
    const payments = await getAllPayments();
    const visits = await getAllVisits();
    const stats = {
      companyName: 'Trends Media Consult',
      totalEnquiries: enquiries.length,
      totalPayments: payments.length,
      totalRevenue: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      totalVisits: visits.length
    };

    const topCards = [
      { label: 'Enquiries', value: stats.totalEnquiries },
      { label: 'Payments', value: stats.totalPayments },
      { label: 'Revenue', value: `₦${stats.totalRevenue.toLocaleString('en-NG')}` },
      { label: 'Traffic', value: stats.totalVisits }
    ];

    const renderTable = (rows, columns) => {
      if (!rows || rows.length === 0) return '<tr><td colspan="100%" class="empty">No records yet.</td></tr>';
      return rows.map((row) => `
        <tr>
          ${columns.map((column) => `<td>${row[column] ?? '-'}</td>`).join('')}
        </tr>
      `).join('');
    };

    const recentVisits = visits.slice(0, 8);

    const dashboardHtml = `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Trends Media Consult Admin Dashboard</title>
        <style>
          :root { --ink:#171717; --paper:#f5f2eb; --panel:#fff; --line:#d9d4ca; --accent:#eb6537; --mint:#cadb45; --slate:#5a5a5a; }
          * { box-sizing:border-box; }
          body { margin:0; background:linear-gradient(180deg,#f5f2eb 0%, #efeae0 100%); color:var(--ink); font-family:Arial,sans-serif; }
          .wrap { max-width:1280px; margin:0 auto; padding:32px 20px 60px; }
          .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:28px; }
          .brand { font-size:14px; letter-spacing:.12em; text-transform:uppercase; font-weight:800; color:var(--accent); }
          .title { font-size:38px; margin:8px 0 0; }
          .actions { display:flex; gap:12px; align-items:center; }
          .button { display:inline-flex; align-items:center; justify-content:center; padding:12px 16px; background:var(--ink); color:#fff; text-decoration:none; border:0; font-weight:700; cursor:pointer; }
          .button.secondary { background:transparent; color:var(--ink); border:1px solid var(--ink); }
          .button:hover { background:var(--accent); color:#171717; }
          .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px,1fr)); gap:16px; margin-bottom:26px; }
          .card { background:var(--panel); border:1px solid var(--line); padding:20px; box-shadow:0 12px 28px rgba(0,0,0,0.04); }
          .card small { display:block; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--slate); }
          .card strong { display:block; margin-top:10px; font-size:32px; }
          .layout { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; }
          .panel { background:var(--panel); border:1px solid var(--line); padding:20px; }
          .panel-header { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:15px; }
          .panel-header h2 { margin:0; font-size:24px; }
          table { width:100%; border-collapse:collapse; }
          th, td { text-align:left; padding:12px 10px; border-bottom:1px solid #e7e2d8; vertical-align:top; }
          th { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--slate); }
          td { font-size:14px; }
          .empty { color:var(--slate); padding:18px 10px; }
          .pill { display:inline-block; padding:6px 8px; background:rgba(235,101,55,0.12); color:var(--accent); font-size:11px; font-weight:700; }
          .muted { color:var(--slate); }
          @media (max-width:820px) { .layout { grid-template-columns:1fr; } .topbar { flex-direction:column; align-items:flex-start; } }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="topbar">
            <div>
              <div class="brand">Trends Media Consult</div>
              <h1 class="title">Admin dashboard</h1>
            </div>
            <div class="actions">
              <a class="button secondary" href="/admin/export/enquiries.csv">Export enquiries</a>
              <a class="button secondary" href="/admin/export/payments.csv">Export payments</a>
              <a class="button" href="/admin/logout">Logout</a>
            </div>
          </div>

          <div class="grid">
            ${topCards.map((card) => `
              <div class="card">
                <small>${card.label}</small>
                <strong>${card.value}</strong>
              </div>
            `).join('')}
          </div>

          <div class="layout">
            <div class="panel">
              <div class="panel-header">
                <h2>Recent enquiries</h2>
                <span class="pill">${enquiries.length} total</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Service</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderTable(enquiries.slice(0, 8), ['name', 'email', 'service', 'message'])}
                </tbody>
              </table>
            </div>

            <div class="panel">
              <div class="panel-header">
                <h2>Traffic</h2>
                <span class="pill">Live</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderTable(recentVisits.map((visit) => ({ path: visit.path, created_at: visit.created_at })), ['path', 'created_at'])}
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel" style="margin-top:18px;">
            <div class="panel-header">
              <h2>Payments</h2>
              <span class="pill">${payments.length} total</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                ${renderTable(payments.slice(0, 8), ['customer_name', 'email', 'plan', 'amount', 'reference'])}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>`;

    res.send(dashboardHtml);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`CMC admin running on http://localhost:${port}`);
    console.log(`Backend mode: ${postgresPool ? 'hosted Postgres' : 'SQLite fallback'}`);
  });
}

module.exports = { createApp, db: sqliteDb, postgresPool };
