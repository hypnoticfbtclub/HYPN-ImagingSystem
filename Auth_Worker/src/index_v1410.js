import base from './index_v149.js';

const VERSION = '1.4.10';
const CURRENT_ITERATIONS = 100000;
const LEGACY_ITERATIONS = 120000;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }), request, env);
      }

      if (url.pathname === '/health') {
        const response = await base.fetch(request, env);
        let data = {};
        try { data = await response.json(); } catch {}
        return json({
          ...data,
          ok: true,
          version: VERSION,
          passwordHashIterations: CURRENT_ITERATIONS,
          legacyPasswordCompatibility: true,
          legacyPasswordIterations: LEGACY_ITERATIONS,
          collaboratorSessionCompatibility: true
        }, 200, request, env);
      }

      if (url.pathname === '/api/collab/login' && request.method === 'POST') {
        return await collaboratorLoginCompat(request, env);
      }

      return await base.fetch(request, env);
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err), version: VERSION }, 500, request, env);
    }
  }
};

async function collaboratorLoginCompat(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const db = requireDb(env);
  await ensureUserColumns(db);

  const body = await request.json();
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? '');

  if (!username || !password) {
    throw new Error('Escribe usuario y contraseña.');
  }

  const user = await db.prepare(
    'SELECT id, username, password_hash, salt, password_cipher, permissions, active FROM users WHERE lower(username)=lower(?) LIMIT 1'
  ).bind(username).first();

  if (!user) {
    throw new Error('Usuario o contraseña incorrectos.');
  }

  if (Number(user.active) !== 1) {
    throw new Error('USUARIO DESACTIVADO — CONTACTA AL ADMIN.');
  }

  const verified = await verifyStoredPasswordCompat(password, user.salt, user.password_hash);
  if (!verified) {
    throw new Error('Usuario o contraseña incorrectos.');
  }

  const permissions = parsePermissions(user.permissions);
  if (!permissions.length) {
    throw new Error('Este colaborador no tiene carteles autorizados.');
  }

  const now = Date.now();
  const needsHashMigration = verified === 'legacy-120000' || verified === 'legacy-current-unprefixed';
  const needsCipher = !user.password_cipher;

  if (needsHashMigration || needsCipher) {
    let passwordHash = String(user.password_hash || '');
    let saltB64 = String(user.salt || '');

    if (needsHashMigration) {
      const newSalt = crypto.getRandomValues(new Uint8Array(16));
      const newHash = await hashPassword(password, newSalt, CURRENT_ITERATIONS);
      passwordHash = `pbkdf2-sha256$${CURRENT_ITERATIONS}$${newHash}`;
      saltB64 = bytesToBase64(newSalt);
    }

    const cipher = await encryptPasswordForAdmin(password, env.SESSION_SECRET);
    await db.prepare(
      'UPDATE users SET password_hash=?, salt=?, password_cipher=?, last_login=?, updated_at=? WHERE id=?'
    ).bind(passwordHash, saltB64, cipher, now, now, Number(user.id)).run();
  } else {
    await db.prepare('UPDATE users SET last_login=? WHERE id=?')
      .bind(now, Number(user.id)).run();
  }

  // IMPORTANTE: /api/me sigue usando el formato histórico de sesión del Worker base.
  // Por eso el token debe conservar: SHA-256("HYPN|" + secret) y formato iv.cipher.
  const session = await encryptSessionCompatible({
    role: 'collab',
    userId: Number(user.id),
    login: String(user.username || username),
    permissions,
    exp: now + 8 * 60 * 60 * 1000
  }, env.SESSION_SECRET);

  return json({
    ok: true,
    version: VERSION,
    session,
    migratedLegacyPassword: needsHashMigration,
    user: {
      username: String(user.username || username),
      permissions,
      last_login: now
    }
  }, 200, request, env);
}

async function verifyStoredPasswordCompat(password, saltB64, stored) {
  const text = String(stored || '');
  const salt = base64ToBytes(String(saltB64 || ''));
  if (!text || !salt.length) return false;

  const parts = text.split('$');
  if (parts.length === 3 && parts[0] === 'pbkdf2-sha256') {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 500000) return false;
    const actual = await hashPassword(password, salt, iterations);
    return timingSafeEqual(actual, parts[2]) ? true : false;
  }

  // Compatibilidad con registros sin prefijo creados por versiones anteriores.
  // V1.4.x tempranas podían usar 100000; V1.3.2 usaba 120000.
  const current = await hashPassword(password, salt, CURRENT_ITERATIONS);
  if (timingSafeEqual(current, text)) return 'legacy-current-unprefixed';

  const legacy = await hashPassword(password, salt, LEGACY_ITERATIONS);
  if (timingSafeEqual(legacy, text)) return 'legacy-120000';

  return false;
}

async function hashPassword(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: saltBytes,
    iterations
  }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function encryptSessionCompatible(payload, secret) {
  const key = await sessionAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  );
  return bytesToBase64Url(iv) + '.' + bytesToBase64Url(cipher);
}

async function sessionAesKey(secret) {
  const digest = await crypto.subtle.digest(
    'SHA-256', encoder.encode('HYPN|' + String(secret))
  );
  return crypto.subtle.importKey(
    'raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
}

async function encryptPasswordForAdmin(password, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const digest = await crypto.subtle.digest(
    'SHA-256', encoder.encode('HYPN-PASSWORD-VAULT|' + String(secret))
  );
  const key = await crypto.subtle.importKey(
    'raw', digest, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(password))
  );
  return bytesToBase64Url(concatBytes(iv, encrypted));
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
  if (!columns.has('password_cipher')) {
    await db.prepare('ALTER TABLE users ADD COLUMN password_cipher TEXT').run();
  }
}

function normalizeUsername(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (s.length > 64) throw new Error('El usuario no puede superar 64 caracteres.');
  if (/[\u0000-\u001F\u007F]/.test(s)) {
    throw new Error('El usuario contiene caracteres no permitidos.');
  }
  return s;
}

function parsePermissions(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(v => String(v || '').trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64ToBytes(str) {
  try {
    const binary = atob(String(str || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

function requireDb(env) {
  if (!env.HYPN_DB) {
    throw new Error('Falta configurar la base Cloudflare D1 con el binding HYPN_DB.');
  }
  return env.HYPN_DB;
}

function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name] || String(env[name]).trim() === '') {
      throw new Error(`Falta variable/secreto del Worker: ${name}`);
    }
  }
}

function cors(response, request, env) {
  try {
    const origin = request.headers.get('Origin');
    if (!origin || !env.PUBLIC_ORIGIN) return response;
    if (origin !== new URL(env.PUBLIC_ORIGIN).origin) return response;
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
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
