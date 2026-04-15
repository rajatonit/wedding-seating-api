// ═══════════════════════════════════════════════════════════════════
//  Wedding Seating API  —  server.js  (v2 — Google SSO)
//  Deploy free on Render.com · MongoDB Atlas M0 free cluster
// ═══════════════════════════════════════════════════════════════════
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const https = require('https');
const { MongoClient, ServerApiVersion } = require('mongodb');

// ── Required env vars ─────────────────────────────────────────────
const {
  PORT = 3000,
  MONGO_URI,
  DB_NAME = 'wedding',
  COLLECTION = 'seating-v1',
  JWT_SECRET, // sign session JWTs — generate: openssl rand -hex 32
  GOOGLE_CLIENT_ID, // from Google Cloud Console (OAuth 2.0 Web Client)
  ADMIN_EMAIL, // Google account email allowed to administer the site
  ALLOWED_ORIGINS = '',
} = process.env;

[
  ['MONGO_URI', MONGO_URI],
  ['JWT_SECRET', JWT_SECRET],
  ['GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID],
  ['ADMIN_EMAIL', ADMIN_EMAIL],
].forEach(([k, v]) => {
  if (!v) throw new Error(`${k} env var is required`);
});

const ADMIN_EMAIL_LOWER = ADMIN_EMAIL.toLowerCase().trim();
const SESSION_TTL = '8h';
const DOC_ID = 'main_seating';

// ── MongoDB ───────────────────────────────────────────────────────
const mongoClient = new MongoClient(MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 5,
  socketTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
});
let _db;
async function getCol() {
  if (!_db) {
    await mongoClient.connect();
    _db = mongoClient.db(DB_NAME);
    await _db
      .collection(COLLECTION)
      .createIndex({ docId: 1 }, { unique: true })
      .catch(() => {});
  }
  return _db.collection(COLLECTION);
}

// ── Seed document ─────────────────────────────────────────────────
function seedDoc() {
  return {
    docId: DOC_ID,
    config: {
      name1: 'Rajat',
      name2: 'Vinita',
      date: 'Sunday, April 19th, 2026',
      venue: 'The Grand Ballroom',
    },
    tables: [
      { id: 't1', name: 'Table 1', x: 1029, y: 674, seats: [] },
      { id: 't2', name: 'Table 2', x: 885, y: 674, seats: [] },
      { id: 't3', name: 'Table 3', x: 726, y: 558, seats: [] },
      { id: 't4', name: 'Table 4', x: 726, y: 674, seats: [] },
      { id: 't5', name: 'Table 5', x: 596, y: 674, seats: [] },
      { id: 't6', name: 'Table 6', x: 596, y: 558, seats: [] },
      { id: 't7', name: 'Table 7', x: 467, y: 647, seats: [] },
      { id: 't8', name: 'Table 8', x: 326, y: 647, seats: [] },
      { id: 't9', name: 'Table 9', x: 498, y: 506, seats: [] },
      { id: 't10', name: 'Table 10', x: 380, y: 506, seats: [] },
      { id: 't11', name: 'Table 11', x: 236, y: 506, seats: [] },
      { id: 't12', name: 'Table 12', x: 498, y: 371, seats: [] },
      { id: 't13', name: 'Table 13', x: 380, y: 371, seats: [] },
      { id: 't14', name: 'Table 14', x: 236, y: 371, seats: [] },
      { id: 't15', name: 'Table 15', x: 236, y: 236, seats: [] },
      { id: 't16', name: 'Table 16', x: 380, y: 236, seats: [] },
      { id: 't17', name: 'Table 17', x: 488, y: 236, seats: [] },
      { id: 't18', name: 'Table 18', x: 326, y: 90, seats: [] },
      { id: 't19', name: 'Table 19', x: 455, y: 90, seats: [] },
      { id: 't20', name: 'Table 20', x: 630, y: 195, seats: [] },
      { id: 't21', name: 'Table 21', x: 630, y: 90, seats: [] },
      { id: 't22', name: 'Table 22', x: 771, y: 195, seats: [] },
      { id: 't23', name: 'Table 23', x: 815, y: 90, seats: [] },
      { id: 't24', name: 'Table 24', x: 923, y: 195, seats: [] },
      { id: 't25', name: 'Table 25', x: 1017, y: 90, seats: [] },
    ],
    updatedAt: new Date(),
  };
}

// ── Express ───────────────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS
      ? ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '1mb' }));

// ── Middleware: verify JWT session ────────────────────────────────
function requireAdmin(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token)
    return res
      .status(401)
      .json({ error: 'Missing Authorization: Bearer <token>' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'admin') throw new Error('not admin');
    req.admin = p;
    next();
  } catch {
    res
      .status(401)
      .json({
        error: 'Session token invalid or expired — please sign in again',
      });
  }
}

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ── Google ID-token verification via tokeninfo endpoint ───────────
// Simple, dependency-free. Fine for low-traffic wedding use.
function verifyGoogleIdToken(idToken) {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const json = JSON.parse(raw);
              if (json.error)
                return reject(new Error(json.error_description || json.error));
              if (json.aud !== GOOGLE_CLIENT_ID)
                return reject(
                  new Error('Token audience does not match GOOGLE_CLIENT_ID'),
                );
              resolve(json);
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// POST /auth/google
// Body: { credential: "<Google One Tap / Sign-In ID token>" }
// → 200 { ok, token, email, name, picture }
// → 403 if email != ADMIN_EMAIL
app.post(
  '/auth/google',
  wrap(async (req, res) => {
    const { credential } = req.body;
    if (!credential)
      return res.status(400).json({ error: 'credential is required' });

    let gPayload;
    try {
      gPayload = await verifyGoogleIdToken(credential);
    } catch (e) {
      return res
        .status(401)
        .json({ error: 'Google token verification failed: ' + e.message });
    }

    const email = (gPayload.email || '').toLowerCase().trim();

    if (email !== ADMIN_EMAIL_LOWER) {
      return res.status(403).json({
        error: `${gPayload.email} is not authorised as admin for this wedding.`,
      });
    }

    const sessionToken = jwt.sign(
      { email, name: gPayload.name, picture: gPayload.picture, role: 'admin' },
      JWT_SECRET,
      { expiresIn: SESSION_TTL },
    );

    res.json({
      ok: true,
      token: sessionToken,
      email: gPayload.email,
      name: gPayload.name,
      picture: gPayload.picture,
    });
  }),
);

// GET /auth/me  — validate a stored session token
app.get('/auth/me', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    email: req.admin.email,
    name: req.admin.name,
    picture: req.admin.picture,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SEATING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// GET /health
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// GET /api/seating  — public read
app.get(
  '/api/seating',
  wrap(async (_req, res) => {
    const col = await getCol();
    let doc = await col.findOne({ docId: DOC_ID });
    if (!doc) {
      const s = seedDoc();
      await col.insertOne(s);
      doc = s;
    }
    const { _id, docId, ...data } = doc;
    res.json({ ok: true, data });
  }),
);

// PUT /api/seating  — admin full replace
app.put(
  '/api/seating',
  requireAdmin,
  wrap(async (req, res) => {
    const body = req.body;
    if (!body?.config || !Array.isArray(body.tables))
      return res
        .status(400)
        .json({ error: 'Body must contain { config, tables }' });
    const col = await getCol();
    const doc = { ...body, docId: DOC_ID, updatedAt: new Date() };
    delete doc._id;
    await col.replaceOne({ docId: DOC_ID }, doc, { upsert: true });
    res.json({ ok: true, updatedAt: doc.updatedAt });
  }),
);

// PATCH /api/seating/config  — admin partial config
app.patch(
  '/api/seating/config',
  requireAdmin,
  wrap(async (req, res) => {
    const col = await getCol();
    const sets = { updatedAt: new Date() };
    Object.keys(req.body).forEach((k) => {
      sets[`config.${k}`] = req.body[k];
    });
    await col.updateOne({ docId: DOC_ID }, { $set: sets }, { upsert: true });
    res.json({ ok: true });
  }),
);

// POST /api/seating/tables  — admin add table
app.post(
  '/api/seating/tables',
  requireAdmin,
  wrap(async (req, res) => {
    const { name, x = 200, y = 200 } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const table = { id: uid(), name: name.trim(), x, y, seats: [] };
    const col = await getCol();
    await col.updateOne(
      { docId: DOC_ID },
      { $push: { tables: table }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
    res.status(201).json({ ok: true, table });
  }),
);

// PUT /api/seating/tables/:id  — admin update table
app.put(
  '/api/seating/tables/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const { id } = req.params;
    const { name, x, y } = req.body;
    const sets = { updatedAt: new Date() };
    if (name !== undefined) sets['tables.$[t].name'] = name;
    if (x !== undefined) sets['tables.$[t].x'] = x;
    if (y !== undefined) sets['tables.$[t].y'] = y;
    const col = await getCol();
    const r = await col.updateOne(
      { docId: DOC_ID },
      { $set: sets },
      { arrayFilters: [{ 't.id': id }] },
    );
    if (!r.matchedCount)
      return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true });
  }),
);

// DELETE /api/seating/tables/:id  — admin delete table
app.delete(
  '/api/seating/tables/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const col = await getCol();
    await col.updateOne(
      { docId: DOC_ID },
      {
        $pull: { tables: { id: req.params.id } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ ok: true });
  }),
);

// POST /api/seating/tables/:id/guests  — admin add guest
app.post(
  '/api/seating/tables/:id/guests',
  requireAdmin,
  wrap(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const guest = { id: uid(), name: name.trim() };
    const col = await getCol();
    const r = await col.updateOne(
      { docId: DOC_ID, 'tables.id': req.params.id },
      { $push: { 'tables.$.seats': guest }, $set: { updatedAt: new Date() } },
    );
    if (!r.matchedCount)
      return res.status(404).json({ error: 'Table not found' });
    res.status(201).json({ ok: true, guest });
  }),
);

// DELETE /api/seating/tables/:tableId/guests/:guestId  — admin remove guest
app.delete(
  '/api/seating/tables/:tableId/guests/:guestId',
  requireAdmin,
  wrap(async (req, res) => {
    const { tableId, guestId } = req.params;
    const col = await getCol();
    await col.updateOne(
      { docId: DOC_ID, 'tables.id': tableId },
      {
        $pull: { 'tables.$.seats': { id: guestId } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ ok: true });
  }),
);

// GET /api/seating/search?q=  — public guest name search
app.get(
  '/api/seating/search',
  wrap(async (req, res) => {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ ok: true, results: [] });
    const col = await getCol();
    const doc = await col.findOne({ docId: DOC_ID });
    if (!doc) return res.json({ ok: true, results: [] });
    const results = [];
    (doc.tables || []).forEach((t) =>
      (t.seats || []).forEach((s) => {
        if (s.name.toLowerCase().includes(q))
          results.push({
            guestId: s.id,
            guestName: s.name,
            tableId: t.id,
            tableName: t.name,
          });
      }),
    );
    res.json({ ok: true, results });
  }),
);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✦ Wedding API  port=${PORT}  admin=${ADMIN_EMAIL}`);
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
