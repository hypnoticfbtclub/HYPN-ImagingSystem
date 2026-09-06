import base from './index_v1411.js';

const VERSION = '1.4.19';
const REGISTRY_PATH = 'Web/vrchat-owners.json';
const PROFILE_ROOT = 'Web/owners';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
        const response = await base.fetch(request, env);
        let data = {};
        try { data = await response.json(); } catch {}
        return json({
          ...data,
          ok: true,
          version: VERSION,
          instanceOwnerProfiles: true,
          instanceOwnerRule: 'FIRST_INSTANCE_MASTER_IF_REGISTERED',
          perOwnerImages: true,
          registryPath: REGISTRY_PATH
        }, 200, request, env);
      }

      if (url.pathname === '/api/vrchat/owners' && request.method === 'GET') {
        return await publicRegistry(request, env);
      }

      if (url.pathname === '/api/owner/vrchat-owners' && request.method === 'GET') {
        return await ownerRegistry(request, env);
      }

      if (url.pathname === '/api/owner/vrchat-owners/create' && request.method === 'POST') {
        return await ownerCreateProfile(request, env);
      }

      if (url.pathname === '/api/owner/vrchat-owners/toggle' && request.method === 'POST') {
        return await ownerToggleProfile(request, env);
      }

      if (url.pathname === '/api/config' && request.method === 'GET' && url.searchParams.get('ownerKey')) {
        return await ownerProfileConfig(request, env, url.searchParams.get('ownerKey'));
      }

      if (url.pathname === '/api/publish' && request.method === 'POST') {
        const clone = request.clone();
        let body = {};
        try { body = await clone.json(); } catch {}
        if (body && body.ownerKey) {
          return await ownerProfilePublish(request, env, body);
        }
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

async function publicRegistry(request, env) {
  const repo = String(env.ALLOWED_REPO || 'hypnoticfbtclub/HYPN-ImagingSystem');
  const branch = String(env.GITHUB_BRANCH || 'main');
  const raw = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${REGISTRY_PATH}`;
  const response = await fetch(raw, { headers: { 'User-Agent': 'HYPN-ImagingSystem/' + VERSION } });
  if (!response.ok) throw new Error(`No se pudo leer el registro público (${response.status}).`);
  const registry = normalizeRegistry(await response.json());
  return json({ ok: true, version: VERSION, registry }, 200, request, env);
}

async function ownerRegistry(request, env) {
  const session = await requireOwnerSession(request, env);
  const branch = env.GITHUB_BRANCH || 'main';
  const { registry } = await getRegistryFile(session, branch);
  return json({ ok: true, version: VERSION, registry }, 200, request, env);
}

async function ownerCreateProfile(request, env) {
  const session = await requireOwnerSession(request, env);
  const body = await request.json();
  const displayName = normalizeVrchatName(body.displayName ?? body.name ?? '');
  if (!displayName) throw new Error('Escribe el nombre exacto de VRChat.');

  const branch = env.GITHUB_BRANCH || 'main';
  const registryFile = await getRegistryFile(session, branch);
  const registry = registryFile.registry;

  const existing = registry.owners.find(
    owner => String(owner.displayName || '').toLowerCase() === displayName.toLowerCase()
  );
  if (existing) {
    if (!existing.active) {
      existing.active = true;
      existing.updatedAt = new Date().toISOString();
      bumpRegistry(registry);
      await saveRegistry(session, registryFile.sha, registry, branch, `HYPN V${VERSION}: reactivar OWNER VRChat ${displayName}`);
    }
    return json({ ok: true, version: VERSION, owner: existing, alreadyExisted: true }, 200, request, env);
  }

  const key = await ownerKeyForName(displayName);
  const profilePath = profileConfigPath(key);

  let profileExists = false;
  try {
    await getGithubFile(session, profilePath, branch);
    profileExists = true;
  } catch {}

  if (!profileExists) {
    const profile = makeEmptyProfileConfig(displayName, key);
    await putGithubFile(
      session,
      profilePath,
      bytesToBase64(encoder.encode(JSON.stringify(profile, null, 2) + '\n')),
      null,
      branch,
      `HYPN V${VERSION}: crear perfil de imágenes ${displayName}`
    );
  }

  const now = new Date().toISOString();
  const owner = {
    displayName,
    key,
    active: true,
    createdAt: now,
    updatedAt: now,
    configPath: `owners/${key}/remote-config.json`
  };
  registry.owners.push(owner);
  registry.owners.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'es', { sensitivity: 'base' }));
  bumpRegistry(registry);

  await saveRegistry(
    session,
    registryFile.sha,
    registry,
    branch,
    `HYPN V${VERSION}: registrar OWNER VRChat ${displayName}`
  );

  return json({ ok: true, version: VERSION, owner }, 200, request, env);
}

async function ownerToggleProfile(request, env) {
  const session = await requireOwnerSession(request, env);
  const body = await request.json();
  const key = normalizeOwnerKey(body.key || body.ownerKey || '');
  const active = body.active !== false;
  const branch = env.GITHUB_BRANCH || 'main';
  const registryFile = await getRegistryFile(session, branch);
  const owner = registryFile.registry.owners.find(item => item.key === key);
  if (!owner) throw new Error('OWNER VRChat no encontrado.');

  owner.active = active;
  owner.updatedAt = new Date().toISOString();
  bumpRegistry(registryFile.registry);
  await saveRegistry(
    session,
    registryFile.sha,
    registryFile.registry,
    branch,
    `HYPN V${VERSION}: ${active ? 'activar' : 'desactivar'} OWNER VRChat ${owner.displayName}`
  );

  return json({ ok: true, version: VERSION, owner }, 200, request, env);
}

async function ownerProfileConfig(request, env, rawKey) {
  const session = await requireOwnerSession(request, env);
  const key = normalizeOwnerKey(rawKey);
  const branch = env.GITHUB_BRANCH || 'main';
  const registryFile = await getRegistryFile(session, branch);
  const owner = requireRegisteredOwner(registryFile.registry, key, false);
  const file = await getGithubFile(session, profileConfigPath(key), branch);
  const config = parseGithubJsonFile(file);
  normalizeProfileConfig(config, owner.displayName, key);
  return json({
    ok: true,
    version: VERSION,
    repo: session.repo,
    branch,
    owner,
    config
  }, 200, request, env);
}

async function ownerProfilePublish(request, env, body) {
  const session = await requireOwnerSession(request, env);
  const key = normalizeOwnerKey(body.ownerKey || '');
  const posterId = String(body.posterId || body.poster || '');
  const imageBase64 = String(body.imageBase64 || '');
  const extension = normalizeExtension(body.extension || 'jpg');
  const mime = String(body.mime || 'image/jpeg').toLowerCase();

  if (!POSTER_SET.has(posterId)) throw new Error('Cartel no válido.');
  validateImagePayload(imageBase64, extension, mime);

  const branch = env.GITHUB_BRANCH || 'main';
  const registryFile = await getRegistryFile(session, branch);
  const owner = requireRegisteredOwner(registryFile.registry, key, true);
  const slot = await publishProfileImage(
    session,
    owner,
    posterId,
    imageBase64,
    extension,
    branch
  );

  return json({
    ok: true,
    version: VERSION,
    ownerKey: key,
    ownerDisplayName: owner.displayName,
    posterId,
    slot
  }, 200, request, env);
}

async function publishProfileImage(session, owner, posterId, imageBase64, extension, branch) {
  const configPath = profileConfigPath(owner.key);
  const file = await getGithubFile(session, configPath, branch);
  const config = parseGithubJsonFile(file);
  normalizeProfileConfig(config, owner.displayName, owner.key);

  const current = Number(config.channels[posterId] || 0);
  const slotsPerChannel = Math.max(1, Number(config.slotsPerChannel || 8));
  const nextSlot = (current + 1) % slotsPerChannel;
  const imagePath = `${PROFILE_ROOT}/${owner.key}/images/${posterId}/slot-${nextSlot}.${extension}`;

  let imageSha = null;
  try {
    const currentImage = await getGithubFile(session, imagePath, branch);
    imageSha = currentImage.sha;
  } catch {}

  await putGithubFile(
    session,
    imagePath,
    imageBase64,
    imageSha,
    branch,
    `HYPN V${VERSION}: ${owner.displayName} publicar ${posterId} slot ${nextSlot}`
  );

  config.channels[posterId] = nextSlot;
  config.version = Number(config.version || 0) + 1;
  config.revision = Number(config.revision || 0) + 1;
  config.updatedAt = new Date().toISOString();
  config.ownerDisplayName = owner.displayName;
  config.ownerKey = owner.key;

  await putGithubFile(
    session,
    configPath,
    bytesToBase64(encoder.encode(JSON.stringify(config, null, 2) + '\n')),
    file.sha,
    branch,
    `HYPN V${VERSION}: ${owner.displayName} activar ${posterId} slot ${nextSlot}`
  );

  return nextSlot;
}

async function getRegistryFile(session, branch) {
  const file = await getGithubFile(session, REGISTRY_PATH, branch);
  const registry = normalizeRegistry(parseGithubJsonFile(file));
  return { file, sha: file.sha, registry };
}

async function saveRegistry(session, sha, registry, branch, message) {
  await putGithubFile(
    session,
    REGISTRY_PATH,
    bytesToBase64(encoder.encode(JSON.stringify(registry, null, 2) + '\n')),
    sha,
    branch,
    message
  );
}

function normalizeRegistry(registry) {
  const out = registry && typeof registry === 'object' ? registry : {};
  out.schema = Number(out.schema || 1);
  out.version = Number(out.version || 1);
  out.revision = Number(out.revision || 0);
  out.updatedAt = out.updatedAt || new Date(0).toISOString();
  out.owners = Array.isArray(out.owners) ? out.owners : [];
  out.owners = out.owners
    .map(item => ({
      displayName: normalizeVrchatName(item?.displayName || ''),
      key: normalizeOwnerKey(item?.key || ''),
      active: item?.active !== false,
      createdAt: item?.createdAt || null,
      updatedAt: item?.updatedAt || null,
      configPath: item?.configPath || (item?.key ? `owners/${normalizeOwnerKey(item.key)}/remote-config.json` : '')
    }))
    .filter(item => item.displayName && item.key);
  return out;
}

function bumpRegistry(registry) {
  registry.version = Number(registry.version || 0) + 1;
  registry.revision = Number(registry.revision || 0) + 1;
  registry.updatedAt = new Date().toISOString();
}

function makeEmptyProfileConfig(displayName, key) {
  const channels = {};
  const labels = {};
  for (const poster of POSTERS) {
    channels[poster.id] = 0;
    labels[poster.id] = poster.label;
  }
  return {
    schema: 3,
    version: 1,
    revision: 1,
    slotsPerChannel: 8,
    ownerDisplayName: displayName,
    ownerKey: key,
    channels,
    labels,
    groups: {
      salon_principal: POSTERS.filter(p => p.group === 'salon_principal').map(p => p.id),
      colaboradores: POSTERS.filter(p => p.group === 'colaboradores').map(p => p.id),
      fuera_club: POSTERS.filter(p => p.group === 'fuera_club').map(p => p.id)
    },
    updatedAt: new Date().toISOString()
  };
}

function normalizeProfileConfig(config, displayName, key) {
  if (!config || typeof config !== 'object') throw new Error('remote-config del OWNER inválido.');
  config.schema = Number(config.schema || 3);
  config.version = Number(config.version || 1);
  config.revision = Number(config.revision || 1);
  config.slotsPerChannel = Math.max(1, Number(config.slotsPerChannel || 8));
  config.ownerDisplayName = displayName;
  config.ownerKey = key;
  config.channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
  for (const id of POSTER_IDS) {
    if (!Number.isFinite(Number(config.channels[id]))) config.channels[id] = 0;
  }
  return config;
}

function requireRegisteredOwner(registry, key, requireActive) {
  const owner = registry.owners.find(item => item.key === key);
  if (!owner) throw new Error('Ese perfil OWNER VRChat no está registrado.');
  if (requireActive && owner.active === false) throw new Error('Ese perfil OWNER VRChat está desactivado.');
  return owner;
}

function profileConfigPath(key) {
  return `${PROFILE_ROOT}/${normalizeOwnerKey(key)}/remote-config.json`;
}

async function ownerKeyForName(displayName) {
  const normalized = displayName.trim().toLowerCase();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(normalized)));
  let hex = '';
  for (let i = 0; i < 8; i++) hex += digest[i].toString(16).padStart(2, '0');
  return 'owner-' + hex;
}

function normalizeVrchatName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length > 80) throw new Error('El nombre de VRChat no puede superar 80 caracteres.');
  if (/[\u0000-\u001F\u007F]/.test(name)) throw new Error('El nombre de VRChat contiene caracteres no permitidos.');
  return name;
}

function normalizeOwnerKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!/^owner-[a-f0-9]{16}$/.test(key)) throw new Error('Clave de perfil OWNER inválida.');
  return key;
}

function parseGithubJsonFile(file) {
  const text = decoder.decode(base64ToBytes(String(file.content || '').replace(/\n/g, '')));
  return JSON.parse(text);
}

function normalizeExtension(extension) {
  const ext = String(extension || '').toLowerCase().replace('jpeg', 'jpg');
  if (ext !== 'jpg' && ext !== 'png') throw new Error('Solo JPG o PNG.');
  return ext;
}

function validateImagePayload(imageBase64, extension, mime) {
  if (!imageBase64) throw new Error('Selecciona una imagen.');
  if (extension === 'jpg' && mime && mime !== 'image/jpeg') throw new Error('La imagen JPG tiene un MIME inválido.');
  if (extension === 'png' && mime && mime !== 'image/png') throw new Error('La imagen PNG tiene un MIME inválido.');
  const estimatedBytes = Math.floor(imageBase64.length * 3 / 4);
  if (estimatedBytes > 5 * 1024 * 1024) throw new Error('La imagen supera 5 MB.');
}

async function requireOwnerSession(request, env) {
  requireEnv(env, ['SESSION_SECRET', 'ALLOWED_REPO']);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Sesión no enviada.');
  const session = await decryptSession(auth.slice(7).trim(), env.SESSION_SECRET);
  if (!session || !session.exp || session.exp < Date.now()) throw new Error('Sesión inválida o vencida.');
  if (session.role !== 'owner') throw new Error('Solo ADMIN puede realizar esta acción.');
  if (!session.gh) throw new Error('La sesión ADMIN no contiene autorización de GitHub.');
  if (!session.repo) session.repo = env.ALLOWED_REPO;
  return session;
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
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('HYPN|' + String(secret)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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
  const res = await fetch(
    `https://api.github.com/repos/${session.repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      headers: { ...githubHeaders(session.gh), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await safeMessage(res)}`);
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

function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name] || String(env[name]).trim() === '') {
      throw new Error(`Falta variable/secreto del Worker: ${name}`);
    }
  }
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
