/**
 * Gravity Lab API + static host.
 *
 * Serves the built SPA and a small SQLite-backed registry of published worlds.
 * Every published world lives at `/@<slug>`; those routes are server-rendered
 * with per-world OpenGraph tags so shared links preview with the world's own
 * title, stats and thumbnail.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR || (existsSync('/data') ? '/data' : join(ROOT, '.data'));
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://gravity-lab.fly.dev';

mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- database

const db = new Database(join(DATA_DIR, 'worlds.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    slug         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    author       TEXT NOT NULL DEFAULT '',
    data         TEXT NOT NULL,
    thumb        BLOB,
    bodies       INTEGER NOT NULL DEFAULT 0,
    total_mass   REAL    NOT NULL DEFAULT 0,
    chaos        REAL    NOT NULL DEFAULT 0,
    chaos_window REAL    NOT NULL DEFAULT 0,
    survivors    INTEGER NOT NULL DEFAULT 0,
    escapees     INTEGER NOT NULL DEFAULT 0,
    first_collision REAL,
    dynamical_time  REAL NOT NULL DEFAULT 0,
    views        INTEGER NOT NULL DEFAULT 0,
    likes        INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    ip_hash      TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS likes (
    slug    TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    PRIMARY KEY (slug, ip_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_worlds_created ON worlds(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_worlds_likes   ON worlds(likes DESC);
  CREATE INDEX IF NOT EXISTS idx_worlds_chaos   ON worlds(chaos DESC);
`);

/** Add a column if this database predates it (in-place schema migration). */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
// Owner key: lets an author come back and update their world.
ensureColumn('worlds', 'key_hash', "TEXT NOT NULL DEFAULT ''");
ensureColumn('worlds', 'key_salt', "TEXT NOT NULL DEFAULT ''");
ensureColumn('worlds', 'updated_at', 'INTEGER');

// Per-deploy salt: IPs are only ever stored as unrecoverable hashes.
const IP_SALT = process.env.IP_SALT || randomBytes(16).toString('hex');
const hashIp = (ip) => createHash('sha256').update(IP_SALT + '|' + ip).digest('hex').slice(0, 32);

/**
 * Owner keys are never stored in plaintext: each world keeps a random salt and
 * a scrypt hash, compared in constant time.
 */
const MIN_KEY_LEN = 6;
const deriveKey = (key, salt) => scryptSync(String(key), salt, 32).toString('hex');

function makeKeyRecord(key) {
  const salt = randomBytes(16).toString('hex');
  return { key_salt: salt, key_hash: deriveKey(key, salt) };
}

function keyMatches(row, key) {
  if (!row?.key_hash || !row?.key_salt || !key) return false;
  const expected = Buffer.from(row.key_hash, 'hex');
  const actual = Buffer.from(deriveKey(key, row.key_salt), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Throttle key guesses per IP so owner keys can't be brute forced. */
const authLog = new Map();
const AUTH_LIMIT = 20;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
function allowAuthAttempt(key) {
  const now = Date.now();
  const hits = (authLog.get(key) || []).filter((t) => now - t < AUTH_WINDOW_MS);
  hits.push(now);
  authLog.set(key, hits);
  return hits.length <= AUTH_LIMIT;
}

// ---------------------------------------------------------------- validation

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const RESERVED = new Set([
  'api', 'assets', 'worlds', 'world', 'index', 'about', 'admin', 'static',
  'new', 'top', 'me', 'login', 'signup', 'null', 'undefined', 'favicon',
]);
const MAX_DATA = 96 * 1024;
const MAX_THUMB = 260 * 1024;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const num = (v, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);

/** Simple in-memory publish throttle: N per window per IP hash. */
const publishLog = new Map();
const PUBLISH_LIMIT = 12;
const PUBLISH_WINDOW_MS = 60 * 60 * 1000;
function allowPublish(key) {
  const now = Date.now();
  const hits = (publishLog.get(key) || []).filter((t) => now - t < PUBLISH_WINDOW_MS);
  if (hits.length >= PUBLISH_LIMIT) {
    publishLog.set(key, hits);
    return false;
  }
  hits.push(now);
  publishLog.set(key, hits);
  return true;
}

// ---------------------------------------------------------------- app

const app = Fastify({ logger: false, bodyLimit: 512 * 1024, trustProxy: true });

const clientIp = (req) =>
  req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '0.0.0.0';

const rowToCard = (r) => ({
  slug: r.slug,
  title: r.title,
  author: r.author,
  bodies: r.bodies,
  totalMass: r.total_mass,
  chaos: r.chaos,
  chaosWindow: r.chaos_window,
  survivors: r.survivors,
  escapees: r.escapees,
  firstCollision: r.first_collision,
  dynamicalTime: r.dynamical_time,
  views: r.views,
  likes: r.likes,
  createdAt: r.created_at,
  updatedAt: r.updated_at ?? null,
  hasThumb: !!r.has_thumb,
  editable: !!r.editable,
});

const LIST_COLS = `slug, title, author, bodies, total_mass, chaos, chaos_window, survivors,
  escapees, first_collision, dynamical_time, views, likes, created_at, updated_at,
  (thumb IS NOT NULL) AS has_thumb, (key_hash != '') AS editable`;

const SORTS = {
  new: 'created_at DESC',
  top: 'likes DESC, views DESC, created_at DESC',
  chaos: 'chaos DESC, created_at DESC',
  big: 'bodies DESC, created_at DESC',
  carnage: '(bodies - survivors) DESC, created_at DESC',
};

app.get('/api/worlds', async (req) => {
  const sort = SORTS[req.query.sort] ? req.query.sort : 'new';
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? '60', 10) || 60, 1), 100);
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM worlds ORDER BY ${SORTS[sort]} LIMIT ?`).all(limit);
  const total = db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c;
  return { sort, total, worlds: rows.map(rowToCard) };
});

app.get('/api/worlds/:slug', async (req, reply) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const row = db.prepare(`SELECT ${LIST_COLS}, data FROM worlds WHERE slug = ?`).get(slug);
  if (!row) return reply.code(404).send({ error: 'not found' });
  db.prepare('UPDATE worlds SET views = views + 1 WHERE slug = ?').run(slug);
  const liked = !!db.prepare('SELECT 1 FROM likes WHERE slug = ? AND ip_hash = ?').get(slug, hashIp(clientIp(req)));
  return { ...rowToCard(row), data: row.data, liked };
});

app.get('/api/worlds/:slug/thumb.jpg', async (req, reply) => {
  const row = db.prepare('SELECT thumb FROM worlds WHERE slug = ?').get(String(req.params.slug || '').toLowerCase());
  if (!row?.thumb) return reply.code(404).send({ error: 'no thumbnail' });
  return reply.header('content-type', 'image/jpeg').header('cache-control', 'public, max-age=86400').send(row.thumb);
});

app.post('/api/worlds/:slug/like', async (req, reply) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!db.prepare('SELECT 1 FROM worlds WHERE slug = ?').get(slug)) {
    return reply.code(404).send({ error: 'not found' });
  }
  const ip = hashIp(clientIp(req));
  const already = db.prepare('SELECT 1 FROM likes WHERE slug = ? AND ip_hash = ?').get(slug, ip);
  if (already) {
    db.prepare('DELETE FROM likes WHERE slug = ? AND ip_hash = ?').run(slug, ip);
    db.prepare('UPDATE worlds SET likes = MAX(likes - 1, 0) WHERE slug = ?').run(slug);
  } else {
    db.prepare('INSERT INTO likes (slug, ip_hash) VALUES (?, ?)').run(slug, ip);
    db.prepare('UPDATE worlds SET likes = likes + 1 WHERE slug = ?').run(slug);
  }
  const { likes } = db.prepare('SELECT likes FROM worlds WHERE slug = ?').get(slug);
  return { likes, liked: !already };
});

app.get('/api/worlds/:slug/available', async (req) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) return { available: false, reason: 'invalid' };
  const taken = !!db.prepare('SELECT 1 FROM worlds WHERE slug = ?').get(slug);
  return { available: !taken, reason: taken ? 'taken' : null };
});

app.post('/api/worlds', async (req, reply) => {
  const body = req.body || {};
  const slug = String(body.slug || '').toLowerCase().trim();
  if (!SLUG_RE.test(slug)) return reply.code(400).send({ error: 'Name must be 2–32 characters: letters, numbers and dashes.' });
  if (RESERVED.has(slug)) return reply.code(400).send({ error: 'That name is reserved — pick another.' });
  if (db.prepare('SELECT 1 FROM worlds WHERE slug = ?').get(slug)) {
    return reply.code(409).send({ error: 'That name is already taken.' });
  }
  const data = String(body.data || '');
  if (!data || data.length > MAX_DATA) return reply.code(400).send({ error: 'World data missing or too large.' });
  const ownerKey = String(body.key || '');
  if (ownerKey.length < MIN_KEY_LEN) {
    return reply.code(400).send({ error: `Secret key must be at least ${MIN_KEY_LEN} characters.` });
  }

  const ip = hashIp(clientIp(req));
  if (!allowPublish(ip)) return reply.code(429).send({ error: 'Too many worlds published from here — try again later.' });

  let thumb = null;
  if (typeof body.thumb === 'string' && body.thumb.startsWith('data:image/jpeg;base64,')) {
    const buf = Buffer.from(body.thumb.slice('data:image/jpeg;base64,'.length), 'base64');
    if (buf.length && buf.length <= MAX_THUMB) thumb = buf;
  }
  const s = body.stats || {};
  const keyRecord = makeKeyRecord(ownerKey);
  db.prepare(
    `INSERT INTO worlds (slug, title, author, data, thumb, bodies, total_mass, chaos, chaos_window,
       survivors, escapees, first_collision, dynamical_time, created_at, ip_hash, key_hash, key_salt)
     VALUES (@slug, @title, @author, @data, @thumb, @bodies, @total_mass, @chaos, @chaos_window,
       @survivors, @escapees, @first_collision, @dynamical_time, @created_at, @ip_hash, @key_hash, @key_salt)`,
  ).run({
    ...keyRecord,
    slug,
    title: clean(body.title, 60) || slug,
    author: clean(body.author, 40),
    data,
    thumb,
    bodies: Math.round(num(s.bodies)),
    total_mass: num(s.totalMass),
    chaos: num(s.chaos),
    chaos_window: num(s.chaosWindow),
    survivors: Math.round(num(s.survivors)),
    escapees: Math.round(num(s.escapees)),
    first_collision: typeof s.firstCollision === 'number' && isFinite(s.firstCollision) ? s.firstCollision : null,
    dynamical_time: num(s.dynamicalTime),
    created_at: Date.now(),
    ip_hash: ip,
  });
  return { slug, url: `${PUBLIC_URL}/@${slug}` };
});

/** Check an owner key without changing anything (unlocks the edit UI). */
app.post('/api/worlds/:slug/auth', async (req, reply) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const row = db.prepare('SELECT key_hash, key_salt FROM worlds WHERE slug = ?').get(slug);
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (!allowAuthAttempt(hashIp(clientIp(req)))) {
    return reply.code(429).send({ error: 'Too many attempts — wait a few minutes.' });
  }
  if (!row.key_hash) {
    return reply.code(403).send({ error: 'This world was published without a secret key and cannot be edited.' });
  }
  if (!keyMatches(row, req.body?.key)) return reply.code(403).send({ error: 'That secret key does not match.' });
  return { ok: true };
});

/** Update a world in place. Requires the owner key set at publish time. */
app.put('/api/worlds/:slug', async (req, reply) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const row = db.prepare('SELECT key_hash, key_salt FROM worlds WHERE slug = ?').get(slug);
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (!allowAuthAttempt(hashIp(clientIp(req)))) {
    return reply.code(429).send({ error: 'Too many attempts — wait a few minutes.' });
  }
  if (!row.key_hash) {
    return reply.code(403).send({ error: 'This world was published without a secret key and cannot be edited.' });
  }
  const body = req.body || {};
  if (!keyMatches(row, body.key)) return reply.code(403).send({ error: 'That secret key does not match.' });

  const data = String(body.data || '');
  if (!data || data.length > MAX_DATA) return reply.code(400).send({ error: 'World data missing or too large.' });

  let thumb;
  if (typeof body.thumb === 'string' && body.thumb.startsWith('data:image/jpeg;base64,')) {
    const buf = Buffer.from(body.thumb.slice('data:image/jpeg;base64,'.length), 'base64');
    if (buf.length && buf.length <= MAX_THUMB) thumb = buf;
  }
  const s = body.stats || {};
  db.prepare(
    `UPDATE worlds SET title = @title, author = @author, data = @data,
       thumb = COALESCE(@thumb, thumb), bodies = @bodies, total_mass = @total_mass,
       chaos = @chaos, chaos_window = @chaos_window, survivors = @survivors, escapees = @escapees,
       first_collision = @first_collision, dynamical_time = @dynamical_time, updated_at = @updated_at
     WHERE slug = @slug`,
  ).run({
    slug,
    title: clean(body.title, 60) || slug,
    author: clean(body.author, 40),
    data,
    thumb: thumb ?? null,
    bodies: Math.round(num(s.bodies)),
    total_mass: num(s.totalMass),
    chaos: num(s.chaos),
    chaos_window: num(s.chaosWindow),
    survivors: Math.round(num(s.survivors)),
    escapees: Math.round(num(s.escapees)),
    first_collision: typeof s.firstCollision === 'number' && isFinite(s.firstCollision) ? s.firstCollision : null,
    dynamical_time: num(s.dynamicalTime),
    updated_at: Date.now(),
  });
  return { slug, url: `${PUBLIC_URL}/@${slug}`, updated: true };
});

/** Delete a world. Requires the owner key; irreversible. */
app.delete('/api/worlds/:slug', async (req, reply) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const row = db.prepare('SELECT key_hash, key_salt FROM worlds WHERE slug = ?').get(slug);
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (!allowAuthAttempt(hashIp(clientIp(req)))) {
    return reply.code(429).send({ error: 'Too many attempts — wait a few minutes.' });
  }
  if (!row.key_hash) {
    return reply.code(403).send({ error: 'This world was published without a secret key and cannot be removed.' });
  }
  if (!keyMatches(row, req.body?.key)) return reply.code(403).send({ error: 'That secret key does not match.' });
  db.prepare('DELETE FROM likes WHERE slug = ?').run(slug);
  db.prepare('DELETE FROM worlds WHERE slug = ?').run(slug);
  return { deleted: true, slug };
});

app.get('/api/health', async () => ({
  ok: true,
  worlds: db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c,
}));

// ---------------------------------------------------------------- static + SPA

// wildcard:true resolves files from disk per request. (With wildcard:false
// @fastify/static enumerates the directory once at registration, so any asset
// built after the process started would fall through to the SPA handler and be
// served as HTML — which breaks module loading.)
await app.register(fastifyStatic, { root: PUBLIC_DIR, index: false, wildcard: true });

const indexHtml = () => readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const YEAR_S = 3.15576e7;
function worldDescription(r) {
  const bits = [`${r.bodies} bodies`];
  if (r.first_collision != null) bits.push(`first impact at ${(r.first_collision / YEAR_S).toPrecision(3)} yr`);
  else if (r.escapees > 0) bits.push(`${r.escapees} ejected`);
  else bits.push('intact');
  if (r.chaos_window > 0) bits.push(r.chaos > 0.3 ? 'chaotic' : r.chaos > 0.1 ? 'unsettled' : 'regular');
  return `${bits.join(' · ')} — a real N-body world on Gravity Lab.`;
}

/** Inject per-world OpenGraph/Twitter tags so shared /@slug links preview well. */
function renderWorldPage(row) {
  const title = `${row.title} — Gravity Lab`;
  const desc = worldDescription(row);
  const url = `${PUBLIC_URL}/@${row.slug}`;
  const img = row.has_thumb ? `${PUBLIC_URL}/api/worlds/${row.slug}/thumb.jpg` : `${PUBLIC_URL}/og-default.png`;
  const tags = `
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Gravity Lab" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(img)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${esc(img)}" />
    <link rel="canonical" href="${esc(url)}" />`;
  return indexHtml()
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace('</head>', `${tags}\n</head>`);
}

app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
  const m = /^\/@([a-z0-9-]{2,32})(?:[/?#]|$)/i.exec(req.url);
  if (m) {
    const row = db.prepare(`SELECT ${LIST_COLS} FROM worlds WHERE slug = ?`).get(m[1].toLowerCase());
    if (row) return reply.type('text/html').send(renderWorldPage(row));
  }
  return reply.type('text/html').send(indexHtml());
});

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`gravity-lab listening on :${PORT} (data: ${DATA_DIR})`);
