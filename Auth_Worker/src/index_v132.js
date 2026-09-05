const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = '1.3.2';

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
        return json({ ok: true, service: 'HYPN Remote Image Auth', version: VERSION, databaseBinding: !!env.HYPN_DB }, 200, request, env);
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
      if (url.pathname === '/api/collab/login' && request.method === 'POST') return await collabLogin(request, env);
      if (url.pathname === '/api/me') return await apiMe(request, env);
      if (url.pathname === '/api/config') return await apiConfig(request, env);
      if (url.pathname === '/api/publish' && request.method === 'POST') return await apiPublish(request, env);
      if (url.pathname === '/api/collab/submit' && request.method === 'POST') return await collabSubmit(request, env);
      if (url.pathname === '/api/collab/submissions') return await collabSubmissions(request, env);
      if (url.pathname === '/api/owner/db-status') return await ownerDbStatus(request, env);
      if (url.pathname === '/api/owner/db-init' && request.method === 'POST') return await ownerDbInit(request, env);
      if (url.pathname === '/api/owner/users') return await ownerUsers(request, env);
      if (url.pathname === '/api/owner/users/create' && request.method === 'POST') return await ownerCreateUser(request, env);
      if (url.pathname === '/api/owner/users/update' && request.method === 'POST') return await ownerUpdateUser(request, env);
      if (url.pathname === '/api/owner/submissions') return await ownerSubmissions(request, env);
      if (url.pathname === '/api/owner/approve' && request.method === 'POST') return await ownerApprove(request, env);
      if (url.pathname === '/api/owner/reject' && request.method === 'POST') return await ownerReject(request, env);

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
  const state = await signState({ returnUrl, ts: Date.now(), nonce: crypto.randomUUID() }, env.SESSION_SECRET);
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
  if (!statePayload || !statePayload.ts || Date.now() - statePayload.ts > 10 * 60 * 1000) throw new Error('Estado OAuth inválido o vencido. Vuelve a iniciar sesión.');
  ensureAllowedReturn(statePayload.returnUrl, env.PUBLIC_ORIGIN);

  const redirectUri = new URL('/auth/callback', url.origin).toString();
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'HYPN-ImagingSystem/' + VERSION },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || 'No se pudo obtener el token OAuth de GitHub.');

  const user = await githubJson('https://api.github.com/user', tokenData.access_token);
  if (env.ALLOWED_USER && String(user.login).toLowerCase() !== String(env.ALLOWED_USER).toLowerCase()) throw new Error('Esta cuenta de GitHub no está autorizada para administrar HYPN.');

  const repo = await githubJson(`https://api.github.com/repos/${env.ALLOWED_REPO}`, tokenData.access_token);
  const p = repo.permissions || {};
  if (!(p.push || p.admin || p.maintain)) throw new Error('La cuenta no tiene permiso de escritura en el repositorio configurado.');

  const session = await encryptSession({ role: 'owner', gh: tokenData.access_token, login: user.login, repo: env.ALLOWED_REPO, permissions: POSTER_IDS, exp: Date.now() + 8 * 60 * 60 * 1000 }, env.SESSION_SECRET);
  const redirect = new URL(statePayload.returnUrl);
  redirect.hash = 'hypn_session=' + encodeURIComponent(session);
  return Response.redirect(redirect.toString(), 302);
}

async function collabLogin(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  if (!username || !password) throw new Error('Escribe usuario y contraseña.');

  const user = await db.prepare('SELECT id, username, password_hash, salt, permissions, active FROM users WHERE lower(username)=lower(?) LIMIT 1').bind(username).first();
  if (!user || Number(user.active) !== 1) throw new Error('Usuario o contraseña incorrectos.');
  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) throw new Error('Usuario o contraseña incorrectos.');

  const permissions = parsePermissions(user.permissions);
  const session = await encryptSession({ role: 'collab', userId: Number(user.id), login: user.username, permissions, exp: Date.now() + 8 * 60 * 60 * 1000 }, env.SESSION_SECRET);
  return json({ ok: true, session, user: { username: user.username, permissions } }, 200, request, env);
}

async function apiMe(request, env) {
  const session = await requireSession(request, env);
  return json({ ok: true, role: session.role, login: session.login, repo: session.repo || env.ALLOWED_REPO, permissions: session.permissions || [] }, 200, request, env);
}

async function apiConfig(request, env) {
  const session = await requireSession(request, env);
  const branch = env.GITHUB_BRANCH || 'main';
  const repo = session.repo || env.ALLOWED_REPO;
  let config;
  if (session.role === 'owner' && session.gh) config = await getRemoteConfigWithToken(session, branch);
  else config = await getRemoteConfigPublic(repo, branch);
  normalizeRemoteConfig(config);
  return json({ ok: true, repo, branch, posters: POSTERS, config }, 200, request, env);
}

async function apiPublish(request, env) {
  const session = await requireOwner(request, env);
  const body = await request.json();
  const posterId = String(body.posterId || body.poster || '');
  const imageBase64 = String(body.imageBase64 || '');
  const extension = normalizeExtension(body.extension || 'jpg');
  const mime = String(body.mime || 'image/jpeg').toLowerCase();
  if (!POSTER_SET.has(posterId)) throw new Error('Cartel no válido.');
  validateImagePayload(imageBase64, extension, mime);
  const branch = env.GITHUB_BRANCH || 'main';
  const slot = await publishPosterImage(session, posterId, imageBase64, extension, branch, `HYPN: publicar ${posterId}`);
  return json({ ok: true, posterId, slot }, 200, request, env);
}

async function collabSubmit(request, env) {
  const session = await requireCollaborator(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const posterId = String(body.posterId || body.poster || '');
  const imageBase64 = String(body.imageBase64 || '');
  const extension = normalizeExtension(body.extension || 'jpg');
  const mime = String(body.mime || 'image/jpeg').toLowerCase();
  if (!POSTER_SET.has(posterId)) throw new Error('Cartel no válido.');
  if (!session.permissions || !session.permissions.includes(posterId)) throw new Error('No tienes permiso para este cartel.');
  validateImagePayload(imageBase64, extension, mime);
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO submissions (user_id, poster_id, image_base64, extension, mime, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(session.userId, posterId, imageBase64, extension, mime, now).run();
  return json({ ok: true, submissionId: Number(result.meta.last_row_id), status: 'pending' }, 200, request, env);
}

async function collabSubmissions(request, env) {
  const session = await requireCollaborator(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const rows = await db.prepare(`SELECT id, poster_id, status, created_at, reviewed_at, reviewed_by, reject_reason, published_slot FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 50`).bind(session.userId).all();
  return json({ ok: true, submissions: rows.results || [] }, 200, request, env);
}

async function ownerDbStatus(request, env) {
  await requireOwner(request, env);
  if (!env.HYPN_DB) return json({ ok: true, bound: false, initialized: false, users: 0, pending: 0 }, 200, request, env);
  try {
    const row = await env.HYPN_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
    if (!row) return json({ ok: true, bound: true, initialized: false, users: 0, pending: 0 }, 200, request, env);
    await ensureSchema(env.HYPN_DB);
    const usersRow = await env.HYPN_DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const pendingRow = await env.HYPN_DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status='pending'").first();
    return json({ ok: true, bound: true, initialized: true, users: Number(usersRow?.n || 0), pending: Number(pendingRow?.n || 0) }, 200, request, env);
  } catch (e) {
    return json({ ok: true, bound: true, initialized: false, users: 0, pending: 0, error: String(e.message || e) }, 200, request, env);
  }
}

async function ownerDbInit(request, env) {
  await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  return json({ ok: true, initialized: true }, 200, request, env);
}

async function ownerUsers(request, env) {
  await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const rows = await db.prepare('SELECT id, username, active, permissions, created_at, updated_at FROM users ORDER BY username COLLATE NOCASE').all();
  const users = (rows.results || []).map(row => ({ ...row, active: Number(row.active) === 1, permissions: parsePermissions(row.permissions) }));
  return json({ ok: true, users }, 200, request, env);
}

async function ownerCreateUser(request, env) {
  await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  const permissions = sanitizePermissions(body.permissions);
  if (!username || username.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (!permissions.length) throw new Error('Selecciona al menos un cartel permitido.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const now = Date.now();
  try {
    await db.prepare(`INSERT INTO users (username, password_hash, salt, permissions, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).bind(username, hash, bytesToBase64(salt), JSON.stringify(permissions), now, now).run();
  } catch (e) {
    if (String(e.message || e).toLowerCase().includes('unique')) throw new Error('Ese usuario ya existe.');
    throw e;
  }
  return json({ ok: true, username }, 200, request, env);
}

async function ownerUpdateUser(request, env) {
  await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID de usuario inválido.');
  const current = await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!current) throw new Error('Usuario no encontrado.');
  const active = body.active === undefined ? Number(current.active) : (body.active ? 1 : 0);
  const permissions = body.permissions === undefined ? parsePermissions(current.permissions) : sanitizePermissions(body.permissions);
  const password = String(body.password || '');
  const now = Date.now();
  if (!permissions.length) throw new Error('El usuario debe conservar al menos un cartel permitido.');
  if (password) {
    if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);
    await db.prepare(`UPDATE users SET password_hash=?, salt=?, permissions=?, active=?, updated_at=? WHERE id=?`).bind(hash, bytesToBase64(salt), JSON.stringify(permissions), active, now, id).run();
  } else {
    await db.prepare(`UPDATE users SET permissions=?, active=?, updated_at=? WHERE id=?`).bind(JSON.stringify(permissions), active, now, id).run();
  }
  return json({ ok: true }, 200, request, env);
}

async function ownerSubmissions(request, env) {
  await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const url = new URL(request.url);
  const requestedStatus = String(url.searchParams.get('status') || 'pending').toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'pending';
  let sql = `SELECT s.id, s.poster_id, s.image_base64, s.extension, s.mime, s.status, s.created_at, s.reviewed_at, s.reviewed_by, s.reject_reason, s.published_slot, u.username FROM submissions s JOIN users u ON u.id=s.user_id`;
  const binds = [];
  if (status !== 'all') { sql += ' WHERE s.status=?'; binds.push(status); }
  sql += ' ORDER BY s.id DESC LIMIT 100';
  const stmt = db.prepare(sql);
  const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return json({ ok: true, submissions: rows.results || [] }, 200, request, env);
}

async function ownerApprove(request, env) {
  const session = await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Solicitud inválida.');
  const sub = await db.prepare(`SELECT s.*, u.username FROM submissions s JOIN users u ON u.id=s.user_id WHERE s.id=? LIMIT 1`).bind(id).first();
  if (!sub) throw new Error('Solicitud no encontrada.');
  if (sub.status !== 'pending') throw new Error('Esta solicitud ya fue revisada.');
  const branch = env.GITHUB_BRANCH || 'main';
  const slot = await publishPosterImage(session, sub.poster_id, sub.image_base64, sub.extension || 'jpg', branch, `HYPN: aprobar ${sub.poster_id} de ${sub.username}`);
  await db.prepare(`UPDATE submissions SET status='approved', reviewed_at=?, reviewed_by=?, reject_reason='', published_slot=? WHERE id=?`).bind(Date.now(), session.login, slot, id).run();
  return json({ ok: true, slot }, 200, request, env);
}

async function ownerReject(request, env) {
  const session = await requireOwner(request, env);
  const db = requireDb(env);
  await ensureSchema(db);
  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Solicitud inválida.');
  const current = await db.prepare('SELECT id, status FROM submissions WHERE id=?').bind(id).first();
  if (!current) throw new Error('Solicitud no encontrada.');
  if (current.status !== 'pending') throw new Error('Esta solicitud ya fue revisada.');
  const reason = String(body.reason ?? body.note ?? '');
  await db.prepare(`UPDATE submissions SET status='rejected', reviewed_at=?, reviewed_by=?, reject_reason=?, published_slot=NULL WHERE id=?`).bind(Date.now(), session.login, reason, id).run();
  return json({ ok: true }, 200, request, env);
}

async function publishPosterImage(session, posterId, imageBase64, extension, branch, messagePrefix) {
  const configPath = 'Web/remote-config.json';
  const file = await getGithubFile(session, configPath, branch);
  const configText = decoder.decode(base64ToBytes(file.content.replace(/\n/g, '')));
  const config = JSON.parse(configText);
  normalizeRemoteConfig(config);
  const current = Number(config.channels[posterId] || 0);
  const slotsPerChannel = Math.max(1, Number(config.slotsPerChannel || 8));
  const nextSlot = (current + 1) % slotsPerChannel;
  const imagePath = `Web/images/${posterId}/slot-${nextSlot}.${extension}`;
  let imageSha = null;
  try { const currentImage = await getGithubFile(session, imagePath, branch); imageSha = currentImage.sha; } catch {}
  await putGithubFile(session, imagePath, imageBase64, imageSha, branch, `${messagePrefix} -> slot ${nextSlot}`);
  config.channels[posterId] = nextSlot;
  config.version = Number(config.version || 0) + 1;
  config.revision = Number(config.revision || 0) + 1;
  config.updatedAt = new Date().toISOString();
  const configB64 = bytesToBase64(encoder.encode(JSON.stringify(config, null, 2) + '\n'));
  await putGithubFile(session, configPath, configB64, file.sha, branch, `${messagePrefix}: activar slot ${nextSlot}`);
  return nextSlot;
}

function normalizeRemoteConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('remote-config.json inválido.');
  config.schema = Number(config.schema || 2);
  config.version = Number(config.version || 1);
  config.slotsPerChannel = Math.max(1, Number(config.slotsPerChannel || 8));
  config.channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
  for (const id of POSTER_IDS) if (!Number.isFinite(Number(config.channels[id]))) config.channels[id] = 0;
  return config;
}

async function getRemoteConfigWithToken(session, branch) {
  const file = await getGithubFile(session, 'Web/remote-config.json', branch);
  const text = decoder.decode(base64ToBytes(file.content.replace(/\n/g, '')));
  return JSON.parse(text);
}

async function getRemoteConfigPublic(repo, branch) {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/Web/remote-config.json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HYPN-ImagingSystem/' + VERSION } });
  if (!res.ok) throw new Error(`No se pudo leer la configuración pública (${res.status}).`);
  return await res.json();
}

function validateImagePayload(imageBase64, extension, mime) {
  if (!imageBase64) throw new Error('Selecciona una imagen.');
  if (extension === 'jpg' && mime && mime !== 'image/jpeg') throw new Error('La imagen JPG tiene un MIME inválido.');
  if (extension === 'png' && mime && mime !== 'image/png') throw new Error('La imagen PNG tiene un MIME inválido.');
  const estimatedBytes = Math.floor(imageBase64.length * 3 / 4);
  if (estimatedBytes > 5 * 1024 * 1024) throw new Error('La imagen supera 5 MB.');
}

function normalizeExtension(extension) {
  const ext = String(extension || '').toLowerCase().replace('jpeg', 'jpg');
  if (ext !== 'jpg' && ext !== 'png') throw new Error('Solo JPG o PNG.');
  return ext;
}

function normalizeUsername(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(s)) return '';
  return s;
}

function sanitizePermissions(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const id of list) {
    const s = String(id || '').trim();
    if (POSTER_SET.has(s) && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

function parsePermissions(value) {
  try {
    if (Array.isArray(value)) return sanitizePermissions(value);
    return sanitizePermissions(JSON.parse(String(value || '[]')));
  } catch { return []; }
}

async function hashPassword(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 120000 }, keyMaterial, 256);
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
  const res = await fetch(`https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, { headers: githubHeaders(session.gh) });
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
  return { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HYPN-ImagingSystem/' + VERSION };
}

async function githubJson(url, token) {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  return await res.json();
}

async function safeMessage(res) {
  try { const data = await res.json(); return data.message || res.statusText; }
  catch { return res.statusText; }
}

function requireEnv(env, names) {
  for (const name of names) if (!env[name] || String(env[name]).trim() === '') throw new Error(`Falta variable/secreto del Worker: ${name}`);
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
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
  } catch { return response; }
}

function json(data, status, request, env) {
  return cors(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }), request, env);
}

function requireDb(env) {
  if (!env.HYPN_DB) throw new Error('Falta configurar la base Cloudflare D1 con el binding HYPN_DB.');
  return env.HYPN_DB;
}

async function ensureSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      poster_id TEXT NOT NULL,
      image_base64 TEXT NOT NULL,
      extension TEXT NOT NULL,
      mime TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by TEXT,
      reject_reason TEXT,
      published_slot INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
  `);
  await ensureColumn(db, 'submissions', 'reviewed_by', 'TEXT');
  await ensureColumn(db, 'submissions', 'reject_reason', 'TEXT');
  await ensureColumn(db, 'submissions', 'published_slot', 'INTEGER');
}

async function ensureColumn(db, table, column, type) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = (info.results || []).some(row => row.name === column);
  if (!exists) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
}

async function requireSession(request, env) {
  requireEnv(env, ['SESSION_SECRET']);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Sesión no enviada.');
  const token = auth.slice(7).trim();
  const session = await decryptSession(token, env.SESSION_SECRET);
  if (!session || !session.exp || session.exp < Date.now()) throw new Error('Sesión inválida o vencida.');
  return session;
}

async function requireOwner(request, env) {
  const session = await requireSession(request, env);
  if (session.role !== 'owner') throw new Error('Solo OWNER puede realizar esta acción.');
  return session;
}

async function requireCollaborator(request, env) {
  const session = await requireSession(request, env);
  if (session.role !== 'collab') throw new Error('Esta acción requiere una sesión de colaborador.');
  return session;
}

async function signState(payload, secret) {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return body + '.' + bytesToBase64Url(sig);
}

async function verifyState(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Estado OAuth inválido.');
  const expected = await hmacSign(parts[0], secret);
  const actual = base64UrlToBytes(parts[1]);
  if (!constantTimeBytes(expected, actual)) throw new Error('Firma OAuth inválida.');
  return JSON.parse(decoder.decode(base64UrlToBytes(parts[0])));
}

async function hmacSign(text, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

async function encryptSession(payload, secret) {
  const key = await sessionAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return bytesToBase64Url(iv) + '.' + bytesToBase64Url(cipher);
}

async function decryptSession(token, secret) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const iv = base64UrlToBytes(parts[0]);
    const cipher = base64UrlToBytes(parts[1]);
    const key = await sessionAesKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(decoder.decode(new Uint8Array(plain)));
  } catch { return null; }
}

async function sessionAesKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('HYPN|' + secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function constantTimeBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function encodePath(path) { return String(path).split('/').map(encodeURIComponent).join('/'); }

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes) { return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function base64UrlToBytes(value) { let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return base64ToBytes(s); }
