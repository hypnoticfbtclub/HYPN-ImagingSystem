const $ = id => document.getElementById(id);
const WORKER = String(window.HYPN_CONFIG?.authWorkerUrl || '').replace(/\/$/, '');
const SESSION_KEY = 'hypn_session_v13';

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
const GROUPS = {
  salon_principal: { label: 'SALÓN PRINCIPAL', ids: POSTERS.filter(p => p.group === 'salon_principal').map(p => p.id) },
  colaboradores: { label: 'COLABORADORES', ids: POSTERS.filter(p => p.group === 'colaboradores').map(p => p.id) },
  fuera_club: { label: 'FUERA DEL CLUB', ids: POSTERS.filter(p => p.group === 'fuera_club').map(p => p.id) }
};
const META = Object.fromEntries(POSTERS.map(p => [p.id, p]));

let sessionToken = sessionStorage.getItem(SESSION_KEY) || '';
let me = null;
let remoteConfig = null;
let ownerBlob = null;
let collabBlob = null;

function setState(text, kind = '') {
  const el = $('systemState');
  el.textContent = text;
  el.className = 'pill' + (kind ? ' ' + kind : '');
}
function msg(id, text, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function workerReady() {
  return WORKER && !WORKER.includes('TU-WORKER');
}
function authHeaders(extra = {}) {
  return sessionToken ? { ...extra, Authorization: 'Bearer ' + sessionToken } : { ...extra };
}
async function workerFetch(path, options = {}, requireAuth = true) {
  if (!workerReady()) throw new Error('Falta configurar el Worker de Cloudflare.');
  const headers = requireAuth ? authHeaders(options.headers || {}) : (options.headers || {});
  const res = await fetch(WORKER + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function captureSessionFromHash() {
  if (!location.hash.startsWith('#hypn_session=')) return;
  const token = decodeURIComponent(location.hash.slice('#hypn_session='.length));
  if (token) {
    sessionToken = token;
    sessionStorage.setItem(SESSION_KEY, token);
  }
  history.replaceState(null, '', location.pathname + location.search);
}
function ownerLogin() {
  if (!workerReady()) return msg('connectionMsg', 'El Worker no está configurado.', 'error');
  const returnUrl = location.origin + location.pathname;
  location.href = `${WORKER}/auth/login?return_url=${encodeURIComponent(returnUrl)}`;
}
async function collaboratorLogin() {
  const button = $('collabLoginBtn');
  button.disabled = true;
  try {
    const username = $('collabUser').value.trim();
    const password = $('collabPassword').value;
    if (!username || !password) throw new Error('Escribe usuario y contraseña.');
    msg('collabLoginMsg', 'Comprobando...');
    const data = await workerFetch('/api/collab/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }, false);
    sessionToken = data.session;
    sessionStorage.setItem(SESSION_KEY, sessionToken);
    $('collabPassword').value = '';
    await restoreSession();
  } catch (err) {
    msg('collabLoginMsg', err.message, 'error');
  } finally {
    button.disabled = false;
  }
}
function logout() {
  sessionToken = '';
  me = null;
  remoteConfig = null;
  ownerBlob = null;
  collabBlob = null;
  sessionStorage.removeItem(SESSION_KEY);
  $('loggedOutBox').style.display = 'grid';
  $('loggedInBox').style.display = 'none';
  $('ownerArea').style.display = 'none';
  $('collabArea').style.display = 'none';
  setState('SIN SESIÓN');
  msg('connectionMsg', 'Sesión cerrada.');
}

async function restoreSession() {
  captureSessionFromHash();
  if (!workerReady()) {
    setState('WORKER PENDIENTE', 'warn');
    msg('connectionMsg', 'Falta conectar Cloudflare.', 'error');
    return;
  }
  if (!sessionToken) {
    setState('SIN SESIÓN');
    return;
  }
  try {
    me = await workerFetch('/api/me');
    $('loginStat').textContent = me.login || '—';
    $('roleStat').textContent = (me.role || '—').toUpperCase();
    $('loggedOutBox').style.display = 'none';
    $('loggedInBox').style.display = 'block';
    setState('CONECTADO', 'ok');
    msg('connectionMsg', `Conectado como ${me.login} (${me.role}).`, 'ok');
    await loadConfig();

    if (me.role === 'owner') {
      $('ownerArea').style.display = 'grid';
      $('collabArea').style.display = 'none';
      renderOwnerPosters();
      await Promise.allSettled([checkDb(), loadPending(), loadUsers()]);
    } else {
      $('ownerArea').style.display = 'none';
      $('collabArea').style.display = 'grid';
      renderCollaboratorPosters();
      await loadMine();
    }
  } catch (err) {
    logout();
    msg('connectionMsg', err.message, 'error');
  }
}

async function loadConfig() {
  const data = await workerFetch('/api/config');
  remoteConfig = data.config;
  if ($('versionStat')) $('versionStat').textContent = remoteConfig.version ?? '—';
  if ($('slotsStat')) $('slotsStat').textContent = remoteConfig.slotsPerChannel ?? '—';
  if ($('channelsStat')) $('channelsStat').textContent = Object.keys(remoteConfig.channels || {}).length;
  if ($('rawConfig')) $('rawConfig').textContent = JSON.stringify(remoteConfig, null, 2);
}

function posterSlot(id) {
  return remoteConfig?.channels?.[id] ?? 0;
}
function renderOwnerPosters() {
  const holder = $('posterGroups');
  const select = $('ownerPosterSelect');
  holder.innerHTML = '';
  select.innerHTML = '';

  for (const [groupId, group] of Object.entries(GROUPS)) {
    const block = document.createElement('div');
    block.className = 'group-block';
    block.innerHTML = `<div class="group-title"><h3>${escapeHtml(group.label)}</h3><span>${group.ids.length} carteles</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'channel-grid';
    group.ids.forEach(id => {
      const p = META[id];
      const card = document.createElement('div');
      card.className = 'channel';
      card.innerHTML = `<h3>${escapeHtml(p.label)}</h3><div class="slot">ID: ${id}<br>Slot activo: <strong>${posterSlot(id)}</strong></div>`;
      grid.appendChild(card);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.label;
      select.appendChild(opt);
    });
    block.appendChild(grid);
    holder.appendChild(block);
  }
}
function renderCollaboratorPosters() {
  const permissions = Array.isArray(me?.permissions) ? me.permissions : [];
  const grid = $('collabPosterGrid');
  const select = $('collabPosterSelect');
  grid.innerHTML = '';
  select.innerHTML = '';

  permissions.forEach(id => {
    if (!META[id]) return;
    const card = document.createElement('div');
    card.className = 'channel';
    card.innerHTML = `<h3>${escapeHtml(META[id].label)}</h3><div class="slot">Autorizado • slot actual ${posterSlot(id)}</div>`;
    grid.appendChild(card);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = META[id].label;
    select.appendChild(opt);
  });

  if (!permissions.length) {
    grid.innerHTML = '<div class="msg warn">Tu cuenta no tiene carteles asignados.</div>';
  }
}

async function fileToJpegBlob(file, maxDimension, maxBytes) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  let quality = 0.9;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob && blob.size > maxBytes && quality > 0.42) {
    quality -= 0.07;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (!blob) throw new Error('No se pudo convertir la imagen.');
  if (blob.size > maxBytes) throw new Error(`La imagen sigue siendo demasiado pesada (${Math.round(blob.size/1024)} KB).`);
  return blob;
}
function canvasToJpeg(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}
function showPreview(imgId, emptyId, blob) {
  const img = $(imgId);
  const empty = $(emptyId);
  if (!blob) {
    img.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  img.src = URL.createObjectURL(blob);
  img.style.display = 'block';
  empty.style.display = 'none';
}
async function onOwnerFile() {
  const file = $('ownerFileInput').files[0];
  if (!file) {
    ownerBlob = null;
    return showPreview('ownerPreview', 'ownerPreviewEmpty', null);
  }
  try {
    msg('ownerPublishMsg', 'Preparando imagen...');
    ownerBlob = await fileToJpegBlob(file, 2048, 2100000);
    showPreview('ownerPreview', 'ownerPreviewEmpty', ownerBlob);
    msg('ownerPublishMsg', `Lista (${Math.round(ownerBlob.size/1024)} KB).`, 'ok');
  } catch (err) {
    ownerBlob = null;
    msg('ownerPublishMsg', err.message, 'error');
  }
}
async function onCollabFile() {
  const file = $('collabFileInput').files[0];
  if (!file) {
    collabBlob = null;
    return showPreview('collabPreview', 'collabPreviewEmpty', null);
  }
  try {
    msg('collabSubmitMsg', 'Preparando imagen para aprobación...');
    collabBlob = await fileToJpegBlob(file, 1600, 650000);
    showPreview('collabPreview', 'collabPreviewEmpty', collabBlob);
    msg('collabSubmitMsg', `Lista (${Math.round(collabBlob.size/1024)} KB).`, 'ok');
  } catch (err) {
    collabBlob = null;
    msg('collabSubmitMsg', err.message, 'error');
  }
}

async function ownerPublish() {
  const btn = $('ownerPublishBtn');
  btn.disabled = true;
  try {
    if (!ownerBlob) throw new Error('Selecciona una imagen.');
    const poster = $('ownerPosterSelect').value;
    if (!poster) throw new Error('Selecciona un cartel.');
    msg('ownerPublishMsg', `Publicando ${META[poster]?.label || poster}...`);
    const data = await workerFetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poster, imageBase64: await blobToBase64(ownerBlob) })
    });
    msg('ownerPublishMsg', `Publicado en ${META[poster].label} → slot ${data.slot}.`, 'ok');
    await loadConfig();
    renderOwnerPosters();
  } catch (err) {
    msg('ownerPublishMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function submitForApproval() {
  const btn = $('submitApprovalBtn');
  btn.disabled = true;
  try {
    if (!collabBlob) throw new Error('Selecciona una imagen.');
    const poster = $('collabPosterSelect').value;
    if (!poster) throw new Error('No tienes un cartel seleccionado.');
    msg('collabSubmitMsg', 'Enviando para aprobación...');
    const data = await workerFetch('/api/collab/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poster, imageBase64: await blobToBase64(collabBlob) })
    });
    msg('collabSubmitMsg', `Solicitud #${data.submissionId || ''} enviada. Estado: PENDIENTE.`, 'ok');
    $('collabFileInput').value = '';
    collabBlob = null;
    showPreview('collabPreview', 'collabPreviewEmpty', null);
    await loadMine();
  } catch (err) {
    msg('collabSubmitMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function checkDb() {
  try {
    const data = await workerFetch('/api/owner/db-status');
    const pill = $('dbPill');
    if (!data.bound) {
      pill.textContent = 'D1 NO VINCULADO';
      pill.className = 'pill bad';
      msg('dbMsg', 'Falta crear/vincular una base Cloudflare D1 con el binding HYPN_DB. La publicación OWNER sigue funcionando.', 'warn');
      return data;
    }
    if (!data.initialized) {
      pill.textContent = 'D1 SIN INICIALIZAR';
      pill.className = 'pill warn';
      msg('dbMsg', 'D1 está vinculado. Pulsa INICIALIZAR BASE.', 'warn');
      return data;
    }
    pill.textContent = 'D1 LISTA';
    pill.className = 'pill ok';
    msg('dbMsg', `${data.users} usuarios • ${data.pending} solicitudes pendientes.`, 'ok');
    return data;
  } catch (err) {
    $('dbPill').textContent = 'D1 ERROR';
    $('dbPill').className = 'pill bad';
    msg('dbMsg', err.message, 'error');
    return null;
  }
}
async function initDb() {
  const btn = $('dbInitBtn');
  btn.disabled = true;
  try {
    msg('dbMsg', 'Inicializando tablas...');
    await workerFetch('/api/owner/db-init', { method: 'POST' });
    msg('dbMsg', 'Base inicializada correctamente.', 'ok');
    await checkDb();
    await loadUsers();
    await loadPending();
  } catch (err) {
    msg('dbMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function selectedCreatePermissions() {
  const ids = [];
  if ($('permSalon').checked) ids.push(...GROUPS.salon_principal.ids);
  if ($('permColab').checked) ids.push(...GROUPS.colaboradores.ids);
  if ($('permFuera').checked) ids.push(...GROUPS.fuera_club.ids);
  return ids;
}
async function createUser() {
  const btn = $('createUserBtn');
  btn.disabled = true;
  try {
    const username = $('newUsername').value.trim();
    const password = $('newPassword').value;
    const permissions = selectedCreatePermissions();
    msg('userCreateMsg', 'Creando usuario...');
    await workerFetch('/api/owner/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, permissions })
    });
    $('newUsername').value = '';
    $('newPassword').value = '';
    msg('userCreateMsg', `Usuario ${username} creado.`, 'ok');
    await loadUsers();
    await checkDb();
  } catch (err) {
    msg('userCreateMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function userGroupState(permissions, groupId) {
  const ids = GROUPS[groupId].ids;
  return ids.every(id => permissions.includes(id));
}
function permissionsFromUserCard(card) {
  const out = [];
  if (card.querySelector('.ug-salon').checked) out.push(...GROUPS.salon_principal.ids);
  if (card.querySelector('.ug-colab').checked) out.push(...GROUPS.colaboradores.ids);
  if (card.querySelector('.ug-fuera').checked) out.push(...GROUPS.fuera_club.ids);
  return out;
}
async function loadUsers() {
  if (!me || me.role !== 'owner') return;
  const holder = $('usersList');
  try {
    const data = await workerFetch('/api/owner/users');
    holder.innerHTML = '';
    if (!data.users.length) {
      holder.innerHTML = '<div class="muted">Aún no hay colaboradores.</div>';
      return;
    }
    data.users.forEach(user => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.dataset.id = user.id;
      card.innerHTML = `
        <div class="user-head">
          <div><strong>${escapeHtml(user.username)}</strong><div class="muted">ID ${user.id}</div></div>
          <span class="pill ${user.active ? 'ok' : 'bad'}">${user.active ? 'ACTIVO' : 'DESACTIVADO'}</span>
        </div>
        <div class="permission-box">
          <label class="check"><input class="ug-salon" type="checkbox" ${userGroupState(user.permissions,'salon_principal')?'checked':''}> Salón Principal</label>
          <label class="check"><input class="ug-colab" type="checkbox" ${userGroupState(user.permissions,'colaboradores')?'checked':''}> Colaboradores</label>
          <label class="check"><input class="ug-fuera" type="checkbox" ${userGroupState(user.permissions,'fuera_club')?'checked':''}> Fuera del Club</label>
        </div>
        <div class="user-actions">
          <button class="ghost small save-perms">GUARDAR PERMISOS</button>
          <button class="ghost small reset-pass">CAMBIAR CLAVE</button>
          <button class="${user.active ? 'danger' : 'ok'} small toggle-active">${user.active ? 'DESACTIVAR' : 'ACTIVAR'}</button>
        </div>`;

      card.querySelector('.save-perms').addEventListener('click', async () => {
        try {
          await updateUser({ id: user.id, permissions: permissionsFromUserCard(card) });
          msg('usersMsg', `Permisos de ${user.username} actualizados.`, 'ok');
          await loadUsers();
        } catch (err) { msg('usersMsg', err.message, 'error'); }
      });
      card.querySelector('.reset-pass').addEventListener('click', async () => {
        const password = prompt(`Nueva contraseña para ${user.username} (mínimo 8 caracteres):`);
        if (!password) return;
        try {
          await updateUser({ id: user.id, password });
          msg('usersMsg', `Contraseña de ${user.username} actualizada.`, 'ok');
        } catch (err) { msg('usersMsg', err.message, 'error'); }
      });
      card.querySelector('.toggle-active').addEventListener('click', async () => {
        try {
          await updateUser({ id: user.id, active: !user.active });
          await loadUsers();
        } catch (err) { msg('usersMsg', err.message, 'error'); }
      });
      holder.appendChild(card);
    });
  } catch (err) {
    holder.innerHTML = '';
    msg('usersMsg', err.message, 'error');
  }
}
async function updateUser(payload) {
  return workerFetch('/api/owner/users/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function statusClass(status) {
  if (status === 'approved') return 'status-approved';
  if (status === 'rejected') return 'status-rejected';
  return 'status-pending';
}
function statusLabel(status) {
  return ({pending:'PENDIENTE',approved:'APROBADA',rejected:'RECHAZADA'})[status] || String(status).toUpperCase();
}
async function loadPending() {
  if (!me || me.role !== 'owner') return;
  const holder = $('pendingList');
  try {
    const data = await workerFetch('/api/owner/submissions?status=pending');
    holder.innerHTML = '';
    if (!data.submissions.length) {
      holder.innerHTML = '<div class="muted">No hay solicitudes pendientes.</div>';
      msg('pendingMsg', '', '');
      return;
    }
    data.submissions.forEach(item => {
      const card = document.createElement('div');
      card.className = 'approval-card';
      const src = item.image_base64 ? `data:image/jpeg;base64,${item.image_base64}` : '';
      card.innerHTML = `
        ${src ? `<img src="${src}" alt="Solicitud ${item.id}">` : ''}
        <div class="approval-meta">
          <div><strong>#${item.id}</strong> • ${escapeHtml(item.username)}</div>
          <div>Cartel: <strong>${escapeHtml(META[item.poster_id]?.label || item.poster_id)}</strong></div>
          <div>Enviada: ${escapeHtml(formatDate(item.created_at))}</div>
          <div class="status-pending">PENDIENTE</div>
        </div>
        <div class="row">
          <button class="ok approve">APROBAR Y PUBLICAR</button>
          <button class="danger reject">RECHAZAR</button>
        </div>`;
      card.querySelector('.approve').addEventListener('click', () => approveSubmission(item.id));
      card.querySelector('.reject').addEventListener('click', () => rejectSubmission(item.id));
      holder.appendChild(card);
    });
    msg('pendingMsg', `${data.submissions.length} solicitudes pendientes.`, 'warn');
  } catch (err) {
    holder.innerHTML = '';
    msg('pendingMsg', err.message, 'error');
  }
}
async function approveSubmission(id) {
  if (!confirm(`¿Aprobar y publicar la solicitud #${id}?`)) return;
  try {
    msg('pendingMsg', `Publicando solicitud #${id}...`);
    const data = await workerFetch('/api/owner/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    });
    msg('pendingMsg', `Solicitud #${id} aprobada → slot ${data.slot}.`, 'ok');
    await loadConfig();
    renderOwnerPosters();
    await loadPending();
    await checkDb();
  } catch (err) { msg('pendingMsg', err.message, 'error'); }
}
async function rejectSubmission(id) {
  const reason = prompt('Motivo del rechazo (opcional):') ?? '';
  try {
    await workerFetch('/api/owner/reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason })
    });
    msg('pendingMsg', `Solicitud #${id} rechazada.`, 'ok');
    await loadPending();
    await checkDb();
  } catch (err) { msg('pendingMsg', err.message, 'error'); }
}

async function loadMine() {
  if (!me || me.role !== 'collab') return;
  const holder = $('mineList');
  try {
    const data = await workerFetch('/api/collab/submissions');
    holder.innerHTML = '';
    if (!data.submissions.length) {
      holder.innerHTML = '<div class="muted">Todavía no has enviado solicitudes.</div>';
      return;
    }
    data.submissions.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-head">
          <strong>#${item.id} • ${escapeHtml(META[item.poster_id]?.label || item.poster_id)}</strong>
          <strong class="${statusClass(item.status)}">${statusLabel(item.status)}</strong>
        </div>
        <div class="muted">Enviada: ${escapeHtml(formatDate(item.created_at))}</div>
        ${item.reviewed_at ? `<div class="muted">Revisada: ${escapeHtml(formatDate(item.reviewed_at))} por ${escapeHtml(item.reviewed_by || 'OWNER')}</div>` : ''}
        ${item.reject_reason ? `<div class="status-rejected">Motivo: ${escapeHtml(item.reject_reason)}</div>` : ''}
        ${item.published_slot !== null && item.published_slot !== undefined ? `<div class="status-approved">Slot publicado: ${item.published_slot}</div>` : ''}`;
      holder.appendChild(div);
    });
  } catch (err) {
    holder.innerHTML = '';
    msg('mineMsg', err.message, 'error');
  }
}
function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

$('loginBtn').addEventListener('click', ownerLogin);
$('collabLoginBtn').addEventListener('click', collaboratorLogin);
$('collabPassword').addEventListener('keydown', e => { if (e.key === 'Enter') collaboratorLogin(); });
$('logoutBtn').addEventListener('click', logout);
$('refreshBtn').addEventListener('click', async () => {
  try {
    await loadConfig();
    if (me?.role === 'owner') {
      renderOwnerPosters();
      await Promise.allSettled([checkDb(), loadPending(), loadUsers()]);
    } else if (me?.role === 'collab') {
      renderCollaboratorPosters();
      await loadMine();
    }
    msg('connectionMsg', 'Estado actualizado.', 'ok');
  } catch (err) { msg('connectionMsg', err.message, 'error'); }
});
$('ownerFileInput').addEventListener('change', onOwnerFile);
$('ownerPublishBtn').addEventListener('click', ownerPublish);
$('collabFileInput').addEventListener('change', onCollabFile);
$('submitApprovalBtn').addEventListener('click', submitForApproval);
$('dbInitBtn').addEventListener('click', initDb);
$('refreshUsersBtn').addEventListener('click', loadUsers);
$('createUserBtn').addEventListener('click', createUser);
$('refreshPendingBtn').addEventListener('click', loadPending);
$('refreshMineBtn').addEventListener('click', loadMine);

restoreSession();
