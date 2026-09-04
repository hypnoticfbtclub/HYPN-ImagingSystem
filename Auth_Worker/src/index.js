const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = '1.1.2';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }), request, env);
      }

      if (url.pathname === '/health') {
        return json({ ok: true, service: 'HYPN Remote Image Auth', version: VERSION }, 200, request, env);
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
            GITHUB_BRANCH: !!env.GITHUB_BRANCH
          },
          public: {
            PUBLIC_ORIGIN: env.PUBLIC_ORIGIN || null,
            ALLOWED_REPO: env.ALLOWED_REPO || null,
            ALLOWED_USER: env.ALLOWED_USER || null,
            GITHUB_BRANCH: env.GITHUB_BRANCH || 'main'
          }
        }, 200, request, env);
      }

      if (url.pathname === '/auth/login') return await login(request, env);
      if (url.pathname === '/auth/callback') return await callback(request, env);
      if (url.pathname === '/api/me') return await apiMe(request, env);
      if (url.pathname === '/api/config') return await apiConfig(request, env);
      if (url.pathname === '/api/publish' && request.method === 'POST') return await apiPublish(request, env);

      return cors(new Response('Not found', { status: 404 }), request, env);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return json({ ok: false, error: message, version: VERSION }, 500, request, env);
    }
  }
};

async function login(request, env) {
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

async function callback(request, env) {
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
    gh: tokenData.access_token,
    login: user.login,
    repo: env.ALLOWED_REPO,
    exp: Date.now() + 8 * 60 * 60 * 1000
  }, env.SESSION_SECRET);

  const redirect = new URL(statePayload.returnUrl);
  redirect.hash = 'hypn_session=' + encodeURIComponent(session);
  return Response.redirect(redirect.toString(), 302);
}

async function apiMe(request, env) {
  const session = await requireSession(request, env);
  return json({
    ok: true,
    login: session.login,
    repo: session.repo,
    expiresAt: new Date(session.exp).toISOString()
  }, 200, request, env);
}

async function apiConfig(request, env) {
  const session = await requireSession(request, env);
  const branch = env.GITHUB_BRANCH || 'main';
  const file = await getGithubFile(session, 'Web/remote-config.json', branch);
  return json({ ok: true, config: JSON.parse(base64ToUtf8(file.content)) }, 200, request, env);
}

async function apiPublish(request, env) {
  const session = await requireSession(request, env);
  const branch = env.GITHUB_BRANCH || 'main';
  const body = await request.json();
  const channel = String(body.channel || '').trim();
  const imageBase64 = String(body.imageBase64 || '');

  if (!channel || !imageBase64) throw new Error('Falta canal o imagen.');
  if (!/^[a-z0-9_-]+$/i.test(channel)) throw new Error('ID de canal inválido.');
  if (imageBase64.length > 3100000) {
    return json({ ok: false, error: 'La imagen comprimida es demasiado grande.' }, 413, request, env);
  }

  const configFile = await getGithubFile(session, 'Web/remote-config.json', branch);
  const config = JSON.parse(base64ToUtf8(configFile.content));
  if (!config.channels || !(channel in config.channels)) {
    return json({ ok: false, error: 'El canal no existe en remote-config.json.' }, 400, request, env);
  }

  const slots = Number(config.slotsPerChannel || 8);
  const current = Number(config.channels[channel] || 0);
  const next = (current + 1) % slots;
  const imagePath = `Web/images/${channel}/slot-${next}.jpg`;

  let imageSha = null;
  try {
    imageSha = (await getGithubFile(session, imagePath, branch)).sha;
  } catch (err) {
    if (!String(err.message).includes('404')) throw err;
  }

  await putGithubFile(session, imagePath, imageBase64, imageSha, branch, `HYPN: actualizar ${channel} slot ${next}`);

  config.channels[channel] = next;
  config.version = Number(config.version || 0) + 1;
  config.updatedAt = new Date().toISOString();

  await putGithubFile(
    session,
    'Web/remote-config.json',
    utf8ToBase64(JSON.stringify(config, null, 2) + '\n'),
    configFile.sha,
    branch,
    `HYPN: publicar ${channel} -> slot ${next}`
  );

  return json({ ok: true, channel, slot: next, version: config.version }, 200, request, env);
}

async function requireSession(request, env) {
  requireEnv(env, ['SESSION_SECRET', 'PUBLIC_ORIGIN', 'ALLOWED_REPO']);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Sesión no encontrada. Inicia sesión con GitHub.');

  const session = await decryptSession(auth.slice(7).trim(), env.SESSION_SECRET);
  if (!session || !session.gh || !session.exp) throw new Error('Sesión inválida.');
  if (Date.now() > session.exp) throw new Error('Sesión vencida. Inicia sesión nuevamente.');
  if (session.repo !== env.ALLOWED_REPO) throw new Error('Repositorio de sesión no autorizado.');
  return session;
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
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  let b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function base64ToUtf8(b64) {
  const bytes = Uint8Array.from(atob(String(b64).replace(/\n/g, '')), c => c.charCodeAt(0));
  return decoder.decode(bytes);
}

function utf8ToBase64(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}
