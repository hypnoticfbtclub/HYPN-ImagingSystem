import base from './index_v1410.js';

const VERSION = '1.4.11';
const DEFAULT_CUSTOM_ROLE = 'COLABORADOR';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') {
        const response = await base.fetch(request, env);
        let data = {};
        try { data = await response.json(); } catch {}
        return json({
          ...data,
          ok: true,
          version: VERSION,
          customRoles: true,
          customRoleMaxLength: 48
        }, 200, request, env);
      }

      if (url.pathname === '/api/me') {
        return await apiMeWithCustomRole(request, env);
      }

      if (url.pathname === '/api/collab/login' && request.method === 'POST') {
        return await collaboratorLoginWithRole(request, env);
      }

      if (url.pathname === '/api/owner/users' && request.method === 'GET') {
        return await adminUsersWithRoles(request, env);
      }

      if (url.pathname === '/api/owner/users/create' && request.method === 'POST') {
        return await adminCreateUserWithRole(request, env);
      }

      if (url.pathname === '/api/owner/users/update' && request.method === 'POST') {
        return await adminUpdateUserWithRole(request, env);
      }

      return await base.fetch(request, env);
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err), version: VERSION }, 500, request, env);
    }
  }
};

async function apiMeWithCustomRole(request, env) {
  const response = await base.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok || data.ok === false) {
    return json(data, response.status || 500, request, env);
  }

  if (data.role === 'owner') {
    return json({ ...data, custom_role: 'OWNER', display_role: 'OWNER' }, 200, request, env);
  }

  if (data.role === 'collab') {
    const db = requireDb(env);
    await ensureCustomRoleColumn(db);
    const row = await db.prepare(
      'SELECT custom_role FROM users WHERE lower(username)=lower(?) LIMIT 1'
    ).bind(String(data.login || '')).first();
    const customRole = normalizeCustomRole(row?.custom_role || DEFAULT_CUSTOM_ROLE);
    return json({ ...data, custom_role: customRole, display_role: customRole }, 200, request, env);
  }

  return json(data, 200, request, env);
}

async function collaboratorLoginWithRole(request, env) {
  const clone = request.clone();
  let body = {};
  try { body = await clone.json(); } catch {}

  const response = await base.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok || data.ok === false) {
    return json(data, response.status || 500, request, env);
  }

  const db = requireDb(env);
  await ensureCustomRoleColumn(db);
  const username = String(data?.user?.username || body.username || '').trim();
  const row = await db.prepare(
    'SELECT custom_role FROM users WHERE lower(username)=lower(?) LIMIT 1'
  ).bind(username).first();
  const customRole = normalizeCustomRole(row?.custom_role || DEFAULT_CUSTOM_ROLE);

  return json({
    ...data,
    version: VERSION,
    custom_role: customRole,
    user: { ...(data.user || {}), custom_role: customRole }
  }, 200, request, env);
}

async function adminUsersWithRoles(request, env) {
  const response = await base.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok || data.ok === false) {
    return json(data, response.status || 500, request, env);
  }

  const db = requireDb(env);
  await ensureCustomRoleColumn(db);
  const rows = await db.prepare('SELECT id, custom_role FROM users').all();
  const roleById = new Map(
    (rows.results || []).map(row => [Number(row.id), normalizeCustomRole(row.custom_role || DEFAULT_CUSTOM_ROLE)])
  );

  const users = (data.users || []).map(user => ({
    ...user,
    custom_role: roleById.get(Number(user.id)) || DEFAULT_CUSTOM_ROLE
  }));

  return json({ ...data, version: VERSION, users }, 200, request, env);
}

async function adminCreateUserWithRole(request, env) {
  const clone = request.clone();
  const body = await clone.json();
  const customRole = normalizeCustomRole(body.custom_role || DEFAULT_CUSTOM_ROLE);

  const response = await base.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok || data.ok === false) {
    return json(data, response.status || 500, request, env);
  }

  const db = requireDb(env);
  await ensureCustomRoleColumn(db);
  const username = String(data.username || body.username || '').trim();
  await db.prepare(
    'UPDATE users SET custom_role=?, updated_at=? WHERE lower(username)=lower(?)'
  ).bind(customRole, Date.now(), username).run();

  return json({ ...data, version: VERSION, custom_role: customRole }, 200, request, env);
}

async function adminUpdateUserWithRole(request, env) {
  const clone = request.clone();
  const body = await clone.json();

  const response = await base.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok || data.ok === false) {
    return json(data, response.status || 500, request, env);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'custom_role')) {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('ID de usuario inválido.');
    const customRole = normalizeCustomRole(body.custom_role || DEFAULT_CUSTOM_ROLE);
    const db = requireDb(env);
    await ensureCustomRoleColumn(db);
    await db.prepare(
      'UPDATE users SET custom_role=?, updated_at=? WHERE id=?'
    ).bind(customRole, Date.now(), id).run();
    data.custom_role = customRole;
  }

  return json({ ...data, version: VERSION }, 200, request, env);
}

async function ensureCustomRoleColumn(db) {
  const info = await db.prepare('PRAGMA table_info(users)').all();
  const columns = new Set((info.results || []).map(row => String(row.name || '').toLowerCase()));
  if (!columns.has('custom_role')) {
    await db.prepare("ALTER TABLE users ADD COLUMN custom_role TEXT NOT NULL DEFAULT 'COLABORADOR'").run();
  }
}

function normalizeCustomRole(value) {
  const role = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!role) return DEFAULT_CUSTOM_ROLE;
  if (role.length > 48) throw new Error('El rol personalizado no puede superar 48 caracteres.');
  if (/[\u0000-\u001F\u007F]/.test(role)) throw new Error('El rol contiene caracteres no permitidos.');
  return role;
}

function requireDb(env) {
  if (!env.HYPN_DB) throw new Error('Falta configurar la base Cloudflare D1 con el binding HYPN_DB.');
  return env.HYPN_DB;
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
