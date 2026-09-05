import base from './index_v145.js';

const VERSION = '1.4.7';
const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();

const POSTER_IDS = [
  'salon_01','salon_02','salon_03','salon_04','salon_05','salon_06',
  'colab_01','colab_02','colab_03','colab_04',
  'fuera_01','fuera_02','fuera_03','fuera_04','fuera_05'
];
const POSTER_SET = new Set(POSTER_IDS);

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }), request, env);
      }

      if (url.pathname === '/health') {
        return json({
          ok: true,
          service: 'HYPN Remote Image Auth',
          version: VERSION,
          databaseBinding: !!env.HYPN_DB,
          passwordHash: 'PBKDF2-SHA256',
          passwordHashIterations: PBKDF2_ITERATIONS,
          ownerPublishesDirectly: true,
          collaboratorsRequireApproval: true,
          userAdmin: {
            rename: true,
            changePassword: true,
            delete: true,
            lastLogin: true
          }
        }, 200, request, env);
      }

      if (url.pathname === '/api/collab/login' && request.method === 'POST') {
        return await collaboratorLogin(request, env);
      }

      if (url.pathname === '/api/owner/users') {
        return await ownerUsers(request, env);
      }

      if (url.pathname === '/api/owner/users/create' && request.method === 'POST') {
        await requireOwnerViaBase(request, env);
        await ensureUserColumns(requireDb(env));
        return await base.fetch(request, env);
      }

      if (url.pathname === '/api/owner/users/update' && request.method === 'POST') {
        return await ownerUpdateUser(request, env);
      }

      if (url.pathname === '/api/owner/users/delete' && request.method === 'POST') {
        return await ownerDeleteUser(request, env);
      }

      return await base.fetch(request, env);
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err), version: VERSION }, 500, request, env);
    }
  }
};

async function ownerUsers(request, env) {
  await requireOwnerViaBase(request, env);
  const db = requireDb(env);
  await ensureUserColumns(db);

  const rows = await db.prepare(
    'SELECT id, username, active, permissions, created_at, updated_at, last_login FROM users ORDER BY username COLLATE NOCASE'
  ).all();

  const users = (rows.results || []).map(row => ({
    id: Number(row.id),
    username: String(row.username || ''),
    active: Number(row.active) === 1,
    permissions: parsePermissions(row.permissions),
    created_at: row.created_at == null ? null : Number(row.created_at),
    updated_at: row.updated_at == null ? null : Number(row.updated_at),
    last_login: row.last_login == null ? null : Number(row.last_login),
    password_protected: true
  }));

  return json({ ok: true, users }, 200, request, env);
}

async function ownerUpdateUser(request, env) {
  await requireOwnerViaBase(request, env);
  const db = requireDb(env);
  await ensureUserColumns(db);

  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID de usuario inválido.');

  const current = await db.prepare('SELECT * FROM users WHERE id=? LIMIT 1').bind(id).first();
  if (!current) throw new Error('Usuario no encontrado.');

  let username = String(current.username || '');
  if (Object.prototype.hasOwnProperty.call(body, 'username')) {
    username = normalizeFlexibleUsername(body.username);
    if (!username) throw new Error('Escribe un usuario.');
    const duplicate = await db.prepare(
      'SELECT id FROM users WHERE lower(username)=lower(?) AND id<>? LIMIT 1'
    ).bind(username, id).first();
    if (duplicate) throw new Error('Ese nombre de usuario ya existe.');
  }

  const active = body.active === undefined ? Number(current.active) : (body.active ? 1 : 0);
  const permissions = body.permissions === undefined
    ? parsePermissions(current.permissions)
    : sanitizePermissions(body.permissions);
  if (!permissions.length) throw new Error('El usuario debe conservar al menos un área/cartel permitido.');

  const now = Date.now();
  const hasPassword = Object.prototype.hasOwnProperty.call(body, 'password');

  if (hasPassword) {
    const password = normalizeFlexiblePassword(body.password);
    if (!password) throw new Error('Escribe la nueva contraseña.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS);
    const storedHash = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${hash}`;
    await db.prepare(
      'UPDATE users SET username=?, password_hash=?, salt=?, permissions=?, active=?, updated_at=? WHERE id=?'
    ).bind(username, storedHash, bytesToBase64(salt), JSON.stringify(permissions), active, now, id).run();
  } else {
    await db.prepare(
      'UPDATE users SET username=?, permissions=?, active=?, updated_at=? WHERE id=?'
    ).bind(username, JSON.stringify(permissions), active, now, id).run();
  }

  return json({ ok: true, id, username }, 200, request, env);
}

async function ownerDeleteUser(request, env) {
  await requireOwnerViaBase(request, env);
  const db = requireDb(env);
  await ensureUserColumns(db);

  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID de usuario inválido.');

  const current = await db.prepare('SELECT id, username FROM users WHERE id=? LIMIT 1').bind(id).first();
  if (!current) throw new Error('Usuario no encontrado.');

  await db.prepare('DELETE FROM submissions WHERE user_id=?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id=?').bind(id).run();

  return json({ ok: true, deleted: true, id, username: current.username }, 200, request, env);
}

async function collaboratorLogin(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const db = requireDb(env);
  await ensureUserColumns(db);

  const body = await request.json();
  const username = normalizeFlexibleUsername(body.username);
  const password = String(body.password ?? '');
  if (!username || password.length < 1) throw new Error('Escribe usuario y contraseña.');

  const user = await db.prepare(
    'SELECT id, username, password_hash, salt, permissions, active FROM users WHERE lower(username)=lower(?) LIMIT 1'
  ).bind(username).first();

  if (!user || Number(user.active) !== 1) throw new Error('Usuario o contraseña incorrectos.');

  const ok = await verifyStoredPassword(password, user.salt, user.password_hash);
  if (!ok) throw new Error('Usuario o contraseña incorrectos.');

  const permissions = parsePermissions(user.permissions);
  const now = Date.now();
  await db.prepare('UPDATE users SET last_login=? WHERE id=?').bind(now, Number(user.id)).run();

  const session = await encryptSession({
    role: 'collab',
    userId: Number(user.id),
    login: user.username,
    permissions,
    exp: now + 8 * 60 * 60 * 1000
  }, env.SESSION_SECRET);

  return json({
    ok: true,
    session,
    user: { username: user.username, permissions, last_login: now }
  }, 200, request, env);
}

async function ensureUserColumns(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
  ).run();

  const info = await db.prepare('PRAGMA table_info(users)').all();
  const columns = new Set((info.results || []).map(row => String(row.name || '').toLowerCase()));
  if (!columns.has('last_login')) {
    await db.prepare('ALTER TABLE users ADD COLUMN last_login INTEGER').run();
  }
}

async function requireOwnerViaBase(request, env) {
  const url = new URL(request.url);
  url.pathname = '/api/me';
  url.search = '';
  const probe = new Request(url.toString(), { method: 'GET', headers: request.headers });
  const response = await base.fetch(probe, env);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.ok === false || data.role !== 'owner') {
    throw new Error(data.error || 'Solo OWNER puede realizar esta acción.');
  }
  return data;
}

function normalizeFlexibleUsername(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (s.length > 64) throw new Error('El usuario no puede superar 64 caracteres.');
  if(/[\u0000-\u001F\u007F]/.test(s)) throw new Error('El usuario contiene caracteres no permitidos.');
  return s;
}

function normalizeFlexiblePassword(value) {
  const s = String(value ?? '');
  if (s.length < 1) return '';
  if (s.length > 256) throw new Error('La contraseña no puede superar 256 caracteres.');
  return s;
}

function sanitizePermissions(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const id = String(value || '').trim();
    if (POSTER_SET.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function parsePermissions(value) {
  try {
    if (Array.isArray(value)) return sanitizePermissions(value);
    return sanitizePermissions(JSON.parse(String(value || '[]')));
  } catch {
    return [];
  }
}

async function hashPassword(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations
  }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyStoredPassword(password, saltB64, stored) {
  const text = String(stored || '');
  let iterations = PBKDF2_ITERATIONS;
  let expected = text;

  const parts = text.split('$');
  if (parts.length === 3 && parts[0] === 'pbkdf2-sha256') {
    const parsed = Number(parts[1]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) return false;
    iterations = parsed;
    expected = parts[2];
  }

  const salt = base64ToBytes(String(saltB64 || ''));
  const actual = await hashPassword(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function encryptSession(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const plain = encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return bytesToBase64Url(concatBytes(iv, new Uint8Array(encrypted)));
}

async function aesKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64ToBytes(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function requireDb(env) {
  if (!env.HYPN_DB) throw new Error('Falta configurar la base Cloudflare D1 con el binding HYPN_DB.');
  return env.HYPN_DB;
}

function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name] || String(env[name]).trim() === '') throw new Error(`Falta variable/secreto del Worker: ${name}`);
  }
}

function cors(response, request, env) {
  try {
    const origin = request.headers.get('Origin');
    if (!origin || !env.PUBLIC_ORIGIN) return response;
    if (origin !== new URL(env.PUBLIC_ORIGIN).origin) return response;
    const h = new Headers(response.headers);
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
  } catch {
    return response;
  }
}

function json(data, status, request, env) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  }), request, env);
}
