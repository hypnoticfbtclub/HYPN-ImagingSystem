import base from './index_v1411.js';

const VERSION = '1.4.18';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
          adminVrchatIdentity: true,
          adminVrchatConfigField: 'adminVrchatName',
          adminVrchatDoesNotGateImages: true
        }, 200, request, env);
      }

      if (url.pathname === '/api/owner/vrchat-admin' && request.method === 'GET') {
        return await getAdminVrchatName(request, env);
      }

      if (url.pathname === '/api/owner/vrchat-admin' && request.method === 'POST') {
        return await saveAdminVrchatName(request, env);
      }

      return await base.fetch(request, env);
    } catch (err) {
      return json({
        ok: false,
        error: err?.message || String(err),
        version: VERSION
      }, 500, request, env);
    }
  }
};

async function getAdminVrchatName(request, env) {
  const session = await requireOwnerSession(request, env);
  const branch = env.GITHUB_BRANCH || 'main';
  const file = await getGithubFile(session, 'Web/remote-config.json', branch);
  const config = parseGithubJsonFile(file);

  return json({
    ok: true,
    version: VERSION,
    adminVrchatName: normalizeVrchatName(config.adminVrchatName || ''),
    updatedAt: config.adminVrchatUpdatedAt || config.updatedAt || null
  }, 200, request, env);
}

async function saveAdminVrchatName(request, env) {
  const session = await requireOwnerSession(request, env);
  const body = await request.json();
  const adminVrchatName = normalizeVrchatName(body.adminVrchatName ?? body.name ?? '');
  const branch = env.GITHUB_BRANCH || 'main';
  const path = 'Web/remote-config.json';
  const file = await getGithubFile(session, path, branch);
  const config = parseGithubJsonFile(file);

  config.adminVrchatName = adminVrchatName;
  config.adminVrchatUpdatedAt = new Date().toISOString();
  config.version = Number(config.version || 0) + 1;
  config.revision = Number(config.revision || 0) + 1;
  config.updatedAt = new Date().toISOString();

  const contentBase64 = bytesToBase64(
    encoder.encode(JSON.stringify(config, null, 2) + '\n')
  );

  await putGithubFile(
    session,
    path,
    contentBase64,
    file.sha,
    branch,
    adminVrchatName
      ? `HYPN V1.4.18: configurar ADMIN VRChat ${adminVrchatName}`
      : 'HYPN V1.4.18: limpiar ADMIN VRChat'
  );

  return json({
    ok: true,
    version: VERSION,
    adminVrchatName,
    configVersion: config.version,
    revision: config.revision,
    updatedAt: config.updatedAt
  }, 200, request, env);
}

function normalizeVrchatName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length > 80) {
    throw new Error('El nombre de VRChat no puede superar 80 caracteres.');
  }
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    throw new Error('El nombre de VRChat contiene caracteres no permitidos.');
  }
  return name;
}

async function requireOwnerSession(request, env) {
  requireEnv(env, ['SESSION_SECRET', 'ALLOWED_REPO']);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    throw new Error('Sesión no enviada.');
  }

  const session = await decryptSession(auth.slice(7).trim(), env.SESSION_SECRET);
  if (!session || !session.exp || session.exp < Date.now()) {
    throw new Error('Sesión inválida o vencida.');
  }
  if (session.role !== 'owner') {
    throw new Error('Solo ADMIN puede realizar esta acción.');
  }
  if (!session.gh) {
    throw new Error('La sesión ADMIN no contiene autorización para guardar la configuración.');
  }

  if (!session.repo) session.repo = env.ALLOWED_REPO;
  return session;
}

function parseGithubJsonFile(file) {
  const text = decoder.decode(
    base64ToBytes(String(file.content || '').replace(/\n/g, ''))
  );
  const config = JSON.parse(text);
  if (!config || typeof config !== 'object') {
    throw new Error('remote-config.json inválido.');
  }
  return config;
}

async function getGithubFile(session, path, branch) {
  const res = await fetch(
    `https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders(session.gh) }
  );
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  }
  return await res.json();
}

async function putGithubFile(session, path, contentBase64, sha, branch, message) {
  const payload = { message, content: contentBase64, branch };
  if (sha) payload.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      headers: { ...githubHeaders(session.gh), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
  }
  return await res.json();
}

function githubHeaders(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HYPN-ImagingSystem/' + VERSION
  };
}

async function safeMessage(res) {
  try {
    const data = await res.json();
    return data.message || res.statusText;
  } catch {
    return res.statusText;
  }
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
  } catch {
    return null;
  }
}

async function sessionAesKey(secret) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode('HYPN|' + String(secret))
  );
  return crypto.subtle.importKey(
    'raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
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
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlToBytes(value) {
  let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return base64ToBytes(s);
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
