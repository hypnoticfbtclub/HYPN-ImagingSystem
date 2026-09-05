const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = '1.3.0';

const POSTERS = [
  { id: 'salon_01', label: 'Salón Principal 1', group: 'salon_principal' },
  { id: 'salon_02', label: 'Salón Principal 2', group: 'salon_principal' },
  { id: 'salon_03', label: 'Salón Principal 3', group: 'salon_principal' },
  { id: 'salon_04', label: 'Salón Principal 4', group: 'salon_principal' },
  { id: 'salon_05', label: 'Salón Principal 5', group: 'salon_principal' },
  { id: 'salon_06', label: 'Salón Principal 6', group: 'salon_principal' },
  { id: 'colab_01', label: 'Colaboradores 1', group: 'colaboradores' },
  { id: 'colab_02', label: 'Colaboradores 2', group: 'colaboradores' },
  { id: 'colab_03', label: 'Colaboradores 3', group: 'colaboradores' },
  { id: 'colab_04', label: 'Colaboradores 4', group: 'colaboradores' },
  { id: 'fuera_01', label: 'Fuera del Club 1', group: 'fuera_club' },
  { id: 'fuera_02', label: 'Fuera del Club 2', group: 'fuera_club' },
  { id: 'fuera_03', label: 'Fuera del Club 3', group: 'fuera_club' },
  { id: 'fuera_04', label: 'Fuera del Club 4', group: 'fuera_club' },
  { id: 'fuera_05', label: 'Fuera del Club 5', group: 'fuera_club' }
];
const POSTER_IDS = POSTERS.map(p => p.id);
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
          databaseBinding: !!env.HYPN_DB
        }, 200, request, env);
      }

      if (url.pathname === '/debug/env') {
        return json({
          ok: true,
          version: VERSION,
          configured: {
            GITHUB_CLIENT_ID: !!env.GITHUB_CLIENT_ID,
            GITHUB_CLIENT_SECRET: !!env.GITHUB_CLIENT_SECRET,
            SESSION_SECRET: !!env.SESSION_SECRET,
            PUBLIC_ORIGIN: !!env.PUBLIC_ORIGIN,
            ALLOWED_REPO: !!env.ALLOWED_REPO,
            ALLOWED_USER: !!env.ALLOWED_USER,
            GITHUB_BRANCH: !!env.GITHUB_BRANCH,
            HYPN_DB: !!env.HYPN_DB
          }
        }, 200, request, env);
      }

      if (url.pathname === '/auth/login') return await ownerLogin(request, env);
      if (url.pathname === '/auth/callback') return await ownerCallback(request, env);

      if (url.pathname === '/api/collab/login' && request.method === 'POST') {
        return await collabLogin(request, env);
      }

      if (url.pathname === '/api/me') return await apiMe(request, env);
      if (url.pathname === '/api/config') return await apiConfig(request, env);

      if (url.pathname === '/api/publish' && request.method === 'POST') {
        return await apiPublish(request, env);
      }

      if (url.pathname === '/api/collab/submit' && request.method === 'POST') {
        return await collabSubmit(request, env);
      }
      if (url.pathname === '/api/collab/submissions') {
        return await collabSubmissions(request, env);
      }

      if (url.pathname === '/api/owner/db-status') return await ownerDbStatus(request, env);
      if (url.pathname === '/api/owner/db-init' && request.method === 'POST') {
        return await ownerDbInit(request, env);
      }
      if (url.pathname === '/api/owner/users') return await ownerUsers(request, env);
      if (url.pathname === '/api/owner/users/create' && request.method === 'POST') {
        return await ownerCreateUser(request, env);
      }
      if (url.pathname === '/api/owner/users/update' && request.method === 'POST') {
        return await ownerUpdateUser(request, env);
      }
      if (url.pathname === '/api/owner/submissions') return await ownerSubmissions(request, env);
      if (url.pathname === '/api/owner/approve' && request.method === 'POST') {
        return await ownerApprove(request, env);
      }
      if (url.pathname === '/api/owner/reject' && request.method === 'POST') {
        return await ownerReject(request, env);
      }

      return cors(new Response('Not found', { status: 404 }), request, env);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return json({ ok: false, error: message, version: VERSION }, 500, request, env);
    }
  }
};

async function ownerLogin(request, env) {
  requireEnv(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'PUBLIC_ORIGIN', 'ALLOWED_REPO']);

  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return_url') || env.PUBLIC_ORIGIN;
  ensureAllowedReturn(returnUrl, env.PUBLIC_ORIGIN);

  const state = await signState({
    returnUrl,
    ts: Date.now(),
    nonce: crypto.randomUUID()
  }, env.SESSION_SECRET);

  const redirectUri = new URL('/auth/callback', url.origin).toString();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'read:user public_repo');
  authorize.searchParams.set('state', state);
  return Response.redirect(authorize.toString(), 302);
}

async function ownerCallback(request, env) {
  requireEnv(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'PUBLIC_ORIGIN', 'ALLOWED_REPO']);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new Error('GitHub no devolvió code/state.');

  const statePayload = await verifyState(state, env.SESSION_SECRET);
  if (!statePayload || !statePayload.ts || Date.now() - statePayload.ts > 10 * 60 * 1000) {
    throw new Error('Estado OAuth inválido o vencido. Vuelve a iniciar sesión.');
  }
  ensureAllowedReturn(statePayload.returnUrl, env.PUBLIC_ORIGIN);

  const redirectUri = new URL('/auth/callback', url.origin).toString();
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HYPN-Remote-Image-System/' + VERSION
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'No se pudo obtener el token OAuth de GitHub.');
  }

  const user = await githubJson('https://api.github.com/user', tokenData.access_token);
  if (env.ALLOWED_USER && String(user.login).toLowerCase() !== String(env.ALLOWED_USER).toLowerCase()) {
    throw new Error('Esta cuenta de GitHub no está autorizada para administrar HYPN.');
  }

  const repo = await githubJson(`https://api.github.com/repos/${env.ALLOWED_REPO}`, tokenData.access_token);
  const p = repo.permissions || {};
  if (!(p.push || p.admin || p.maintain)) {
    throw new Error('La cuenta no tiene permiso de escritura en el repositorio configurado.');
  }

  const session = await encryptSession({
    role: 'owner',
    gh: tokenData.access_token,
    login: user.login,
    repo: env.ALLOWED_REPO,
    permissions: POSTER_IDS,
    exp: Date.now() + 8 * 60 * 60 * 1000
  }, env.SESSION_SECRET);

  const redirect = new URL(statePayload.returnUrl);
  redirect.hash = 'hypn_session=' + encodeURIComponent(session);
  return Response.redirect(redirect.toString(), 302);
}

async function collabLogin(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const db = requireDb(env);
  const body = await request.json();
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');

  if (!username || !password) throw new Error('Escribe usuario y contraseña.');

  const user = await db.prepare(
    'SELECT id, username, password_hash, salt, permissions, active FROM users WHERE lower(username)=lower(?) LIMIT 1'
  ).bind(username).first();

  if (!user || Number(user.active) !== 1) {
    throw new Error('Usuario o contraseña incorrectos.');
  }

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) throw new Error('Usuario o contraseña incorrectos.');

  const permissions = parsePermissions(user.permissions);
  const session = await encryptSession({
    role: 'collab',
    userId: Number(user.id),
    login: user.username,
    permissions,
    exp: Date.now() + 8 * 60 * 60 * 1000
  }, env.SESSION_SECRET);

  return json({
    ok: true,
    session,
    role: 'collab',
    login: user.username,
    permissions
  }, 200, request, env);
}

async function apiMe(request, env) {
  const session = await requireAnySession(request, env);
  const role = session.role || (session.gh ? 'owner' : 'collab');
  return json({
    ok: true,
    role,
    login: session.login,
    repo: session.repo || env.ALLOWED_REPO || null,
    permissions: role === 'owner' ? POSTER_IDS : sanitizePermissions(session.permissions),
    databaseReady: !!env.HYPN_DB,
    expiresAt: new Date(session.exp).toISOString()
  }, 200, request, env);
}

async function apiConfig(request, env) {
  const session = await requireAnySession(request, env);
  const config = await loadRemoteConfig(session, env);
  return json({ ok: true, config }, 200, request, env);
}

async function apiPublish(request, env) {
  const owner = await requireOwnerSession(request, env);
  const body = await request.json();
  const poster = String(body.poster || body.channel || '').trim();
  const imageBase64 = String(body.imageBase64 || '');
  const result = await publishPoster(owner, env, poster, imageBase64);
  return json({ ok: true, ...result }, 200, request, env);
}

async function collabSubmit(request, env) {
  const session = await requireCollabSession(request, env);
  const db = requireDb(env);
  const body = await request.json();
  const poster = String(body.poster || '').trim();
  const imageBase64 = String(body.imageBase64 || '');

  if (!POSTER_SET.has(poster)) throw new Error('Cartel inválido.');
  const permissions = sanitizePermissions(session.permissions);
  if (!permissions.includes(poster)) throw new Error('No tienes permiso para enviar imágenes a ese cartel.');
  if (!imageBase64) throw new Error('Falta la imagen.');
  if (imageBase64.length > 900000) {
    throw new Error('La imagen pendiente es demasiado grande. Usa una imagen de menos de ~650 KB.');
  }

  const pendingCount = await db.prepare(
    "SELECT COUNT(*) AS total FROM submissions WHERE user_id=? AND status='pending'"
  ).bind(session.userId).first();
  if (pendingCount && Number(pendingCount.total) >= 10) {
    throw new Error('Tienes 10 solicitudes pendientes. Espera a que el OWNER revise alguna.');
  }

  const now = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO submissions
      (user_id, username, poster_id, image_base64, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).bind(session.userId, session.login, poster, imageBase64, now).run();

  return json({
    ok: true,
    submissionId: result.meta?.last_row_id || null,
    status: 'pending',
    poster
  }, 200, request, env);
}

async function collabSubmissions(request, env) {
  const session = await requireCollabSession(request, env);
  const db = requireDb(env);
  const result = await db.prepare(
    `SELECT id, poster_id, status, created_at, reviewed_at, reviewed_by, reject_reason, published_slot
     FROM submissions
     WHERE user_id=?
     ORDER BY id DESC
     LIMIT 30`
  ).bind(session.userId).all();

  return json({ ok: true, submissions: result.results || [] }, 200, request, env);
}

async function ownerDbStatus(request, env) {
  await requireOwnerSession(request, env);
  if (!env.HYPN_DB) {
    return json({ ok: true, bound: false, initialized: false }, 200, request, env);
  }

  let initialized = false;
  let users = 0;
  let pending = 0;
  try {
    const u = await env.HYPN_DB.prepare('SELECT COUNT(*) AS total FROM users').first();
    const p = await env.HYPN_DB.prepare("SELECT COUNT(*) AS total FROM submissions WHERE status='pending'").first();
    users = Number(u?.total || 0);
    pending = Number(p?.total || 0);
    initialized = true;
  } catch {
    initialized = false;
  }

  return json({ ok: true, bound: true, initialized, users, pending }, 200, request, env);
}

async function ownerDbInit(request, env) {
  await requireOwnerSession(request, env);
  const db = requireDb(env);
  await createSchema(db);
  return json({ ok: true, initialized: true }, 200, request, env);
}

async function ownerUsers(request, env) {
  await requireOwnerSession(request, env);
  const db = requireDb(env);
  const result = await db.prepare(
    `SELECT id, username, permissions, active, created_at, updated_at
     FROM users ORDER BY lower(username) ASC`
  ).all();

  const users = (result.results || []).map(u => ({
    ...u,
    active: Number(u.active) === 1,
    permissions: parsePermissions(u.permissions)
  }));
  return json({ ok: true, users }, 200, request, env);
}

async function ownerCreateUser(request, env) {
  const owner = await requireOwnerSession(request, env);
  const db = requireDb(env);
  const body = await request.json();
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  const permissions = sanitizePermissions(body.permissions);

  validateUsername(username);
  validatePassword(password);
  if (permissions.length === 0) throw new Error('Selecciona al menos un cartel permitido.');

  const existing = await db.prepare('SELECT id FROM users WHERE lower(username)=lower(?) LIMIT 1').bind(username).first();
  if (existing) throw new Error('Ese usuario ya existe.');

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64(saltBytes);
  const passwordHash = await hashPassword(password, saltBytes);
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO users (username, password_hash, salt, permissions, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).bind(username, passwordHash, salt, JSON.stringify(permissions), now, now).run();

  await writeAudit(db, owner.login, 'user_create', username);
  return json({ ok: true, username }, 200, request, env);
}

async function ownerUpdateUser(request, env) {
  const owner = await requireOwnerSession(request, env);
  const db = requireDb(env);
  const body = await request.json();
  const id = Number(body.id || 0);
  if (!id) throw new Error('Usuario inválido.');

  const current = await db.prepare('SELECT id, username FROM users WHERE id=?').bind(id).first();
  if (!current) throw new Error('Usuario no encontrado.');

  const now = new Date().toISOString();

  if (typeof body.active === 'boolean') {
    await db.prepare('UPDATE users SET active=?, updated_at=? WHERE id=?')
      .bind(body.active ? 1 : 0, now, id).run();
  }

  if (Array.isArray(body.permissions)) {
    const permissions = sanitizePermissions(body.permissions);
    if (permissions.length === 0) throw new Error('El usuario debe conservar al menos un cartel permitido.');
    await db.prepare('UPDATE users SET permissions=?, updated_at=? WHERE id=?')
      .bind(JSON.stringify(permissions), now, id).run();
  }

  if (body.password !== undefined && String(body.password) !== '') {
    const password = String(body.password);
    validatePassword(password);
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bytesToBase64(saltBytes);
    const passwordHash = await hashPassword(password, saltBytes);
    await db.prepare('UPDATE users SET password_hash=?, salt=?, updated_at=? WHERE id=?')
      .bind(passwordHash, salt, now, id).run();
  }

  await writeAudit(db, owner.login, 'user_update', current.username);
  return json({ ok: true, id }, 200, request, env);
}

async function ownerSubmissions(request, env) {
  await requireOwnerSession(request, env);
  const db = requireDb(env);
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'pending');
  const allowedStatus = ['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending';

  let sql = `SELECT id, user_id, username, poster_id, image_base64, status, created_at,
                    reviewed_at, reviewed_by, reject_reason, published_slot
             FROM submissions`;
  const binds = [];
  if (allowedStatus !== 'all') {
    sql += ' WHERE status=?';
    binds.push(allowedStatus);
  }
  sql += ' ORDER BY id DESC LIMIT 30';

  const stmt = db.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return json({ ok: true, submissions: result.results || [] }, 200, request, env);
}

async function ownerApprove(request, env) {
  const owner = await requireOwnerSession(request, env);
  const db = requireDb(env);
  const body = await request.json();
  const id = Number(body.id || 0);
  if (!id) throw new Error('Solicitud inválida.');

  const submission = await db.prepare(
    `SELECT id, username, poster_id, image_base64, status
     FROM submissions WHERE id=? LIMIT 1`
  ).bind(id).first();

  if (!submission) throw new Error('Solicitud no encontrada.');
  if (submission.status !== 'pending') throw new Error('La solicitud ya fue revisada.');

  const published = await publishPoster(owner, env, submission.poster_id, submission.image_base64);
  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE submissions
     SET status='approved', reviewed_at=?, reviewed_by=?, published_slot=?, image_base64=NULL
     WHERE id=?`
  ).bind(now, owner.login, published.slot, id).run();

  await writeAudit(db, owner.login, 'submission_approve', String(id));
  return json({ ok: true, id, poster: submission.poster_id, slot: published.slot }, 200, request, env);
}

async function ownerReject(request, env) {
  const owner = await requireOwnerSession(request, env);
  const db = requireDb(env);
  const body = await request.json();
  const id = Number(body.id || 0);
  const reason = String(body.reason || '').trim().slice(0, 250);
  if (!id) throw new Error('Solicitud inválida.');

  const submission = await db.prepare('SELECT status FROM submissions WHERE id=?').bind(id).first();
  if (!submission) throw new Error('Solicitud no encontrada.');
  if (submission.status !== 'pending') throw new Error('La solicitud ya fue revisada.');

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE submissions
     SET status='rejected', reviewed_at=?, reviewed_by=?, reject_reason=?, image_base64=NULL
     WHERE id=?`
  ).bind(now, owner.login, reason, id).run();

  await writeAudit(db, owner.login, 'submission_reject', String(id));
  return json({ ok: true, id }, 200, request, env);
}

async function publishPoster(owner, env, poster, imageBase64) {
  if (!POSTER_SET.has(poster)) throw new Error('Cartel inválido.');
  if (!imageBase64) throw new Error('Falta la imagen.');
  if (imageBase64.length > 3100000) throw new Error('La imagen comprimida es demasiado grande.');

  const branch = env.GITHUB_BRANCH || 'main';
  const configFile = await getGithubFile(owner, 'Web/remote-config.json', branch);
  const config = JSON.parse(base64ToUtf8(configFile.content));

  if (!config.channels || !(poster in config.channels)) {
    throw new Error('El cartel no existe en remote-config.json.');
  }

  const slots = Number(config.slotsPerChannel || 8);
  const current = Number(config.channels[poster] || 0);
  const next = (current + 1) % slots;
  const imagePath = `Web/images/${poster}/slot-${next}.jpg`;

  let imageSha = null;
  try {
    imageSha = (await getGithubFile(owner, imagePath, branch)).sha;
  } catch (err) {
    if (!String(err.message).includes('404')) throw err;
  }

  await putGithubFile(owner, imagePath, imageBase64, imageSha, branch, `HYPN: actualizar ${poster} slot ${next}`);

  config.channels[poster] = next;
  config.version = Number(config.version || 0) + 1;
  config.updatedAt = new Date().toISOString();

  await putGithubFile(
    owner,
    'Web/remote-config.json',
    utf8ToBase64(JSON.stringify(config, null, 2) + '\n'),
    configFile.sha,
    branch,
    `HYPN: publicar ${poster} -> slot ${next}`
  );

  return { poster, slot: next, version: config.version };
}

async function loadRemoteConfig(session, env) {
  const branch = env.GITHUB_BRANCH || 'main';
  if (session.gh) {
    const file = await getGithubFile(session, 'Web/remote-config.json', branch);
    return JSON.parse(base64ToUtf8(file.content));
  }

  const raw = `https://raw.githubusercontent.com/${env.ALLOWED_REPO}/${encodeURIComponent(branch)}/Web/remote-config.json`;
  const res = await fetch(raw, { headers: { 'User-Agent': 'HYPN-Remote-Image-System/' + VERSION } });
  if (!res.ok) throw new Error('No se pudo leer la configuración remota.');
  return await res.json();
}

async function requireAnySession(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Sesión no encontrada.');
  const session = await decryptSession(auth.slice(7).trim(), env.SESSION_SECRET);
  if (!session || !session.exp || !session.login) throw new Error('Sesión inválida.');
  if (Date.now() > session.exp) throw new Error('Sesión vencida. Inicia sesión nuevamente.');
  return session;
}

async function requireOwnerSession(request, env) {
  const session = await requireAnySession(request, env);
  const role = session.role || (session.gh ? 'owner' : 'collab');
  if (role !== 'owner' || !session.gh) throw new Error('Esta acción requiere acceso OWNER.');
  if (session.repo !== env.ALLOWED_REPO) throw new Error('Repositorio de sesión no autorizado.');
  return session;
}

async function requireCollabSession(request, env) {
  const session = await requireAnySession(request, env);
  if (session.role !== 'collab' || !session.userId) throw new Error('Esta acción requiere una cuenta de colaborador.');
  return session;
}

function requireDb(env) {
  if (!env.HYPN_DB) {
    throw new Error('Falta configurar la base Cloudflare D1 con el binding HYPN_DB.');
  }
  return env.HYPN_DB;
}

async function createSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      permissions TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      poster_id TEXT NOT NULL,
      image_base64 TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      reject_reason TEXT,
      published_slot INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id)`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      created_at TEXT NOT NULL
    )`
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

async function writeAudit(db, actor, action, target) {
  try {
    await db.prepare(
      'INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, ?)'
    ).bind(actor || 'unknown', action, target || '', new Date().toISOString()).run();
  } catch {
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validateUsername(username) {
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('El usuario debe tener 3-32 caracteres: letras, números, punto, guion o guion bajo.');
  }
}

function validatePassword(password) {
  if (String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (String(password).length > 128) throw new Error('La contraseña es demasiado larga.');
}

function sanitizePermissions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const id of value) {
    const s = String(id || '').trim();
    if (POSTER_SET.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function parsePermissions(value) {
  try {
    return sanitizePermissions(JSON.parse(String(value || '[]')));
  } catch {
    return [];
  }
}

async function hashPassword(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: saltBytes,
    iterations: 120000
  }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password, saltB64, expectedB64) {
  const salt = base64ToBytes(saltB64);
  const actual = await hashPassword(password, salt);
  return timingSafeEqual(actual, String(expectedB64 || ''));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getGithubFile(session, path, branch) {
  const res = await fetch(
    `https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders(session.gh) }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  return await res.json();
}

async function putGithubFile(session, path, contentBase64, sha, branch, message) {
  const payload = { message, content: contentBase64, branch };
  if (sha) payload.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { ...githubHeaders(session.gh), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  return await res.json();
}

function githubHeaders(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HYPN-Remote-Image-System/' + VERSION
  };
}

async function githubJson(url, token) {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  return await res.json();
}

async function safeMessage(res) {
  try {
    const data = await res.json();
    return data.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name] || String(env[name]).trim() === '') {
      throw new Error(`Falta variable/secreto del Worker: ${name}`);
    }
  }
}

function ensureAllowedReturn(returnUrl, publicOrigin) {
  const target = new URL(returnUrl);
  const allowed = new URL(publicOrigin);
  if (target.origin !== allowed.origin) throw new Error('return_url no autorizado.');
}

function cors(response, request, env) {
  try {
    const origin = request.headers.get('Origin');
    if (!origin || !env.PUBLIC_ORIGIN) return response;
    if (origin !== new URL(env.PUBLIC_ORIGIN).origin) return response;

    const h = new Headers(response.headers);
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
  } catch {
    return response;
  }
}

function json(data, status, request, env) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  }), request, env);
}

async function signState(payload, secret) {
  const part = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(part));
  return part + '.' + base64UrlEncode(new Uint8Array(sig));
}

async function verifyState(value, secret) {
  const [part, sig] = String(value).split('.');
  if (!part || !sig) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sig), encoder.encode(part));
  if (!ok) return null;
  return JSON.parse(decoder.decode(base64UrlDecode(part)));
}

async function sessionKey(secret) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSession(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sessionKey(secret);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  const bytes = new Uint8Array(iv.length + cipher.byteLength);
  bytes.set(iv, 0);
  bytes.set(new Uint8Array(cipher), iv.length);
  return base64UrlEncode(bytes);
}

async function decryptSession(token, secret) {
  try {
    const bytes = base64UrlDecode(token);
    const iv = bytes.slice(0, 12);
    const cipher = bytes.slice(12);
    const key = await sessionKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  let b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return base64ToBytes(b64);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const s = atob(String(value));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function base64ToUtf8(b64) {
  return decoder.decode(base64ToBytes(String(b64).replace(/\n/g, '')));
}

function utf8ToBase64(text) {
  return bytesToBase64(encoder.encode(text));
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}
