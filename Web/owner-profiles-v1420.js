(() => {
  'use strict';

  const VERSION = '1.4.20';
  const SESSION_KEY = 'hypn_session_v141';
  const SELECTED_KEY = 'hypn_selected_vrchat_owner_v1420';
  const DEFAULT_OWNER_KEY = 'owner-21ea2b5e65742aa8';
  const DEFAULT_OWNER_NAME = 'Korvax Leviatán';

  let selectedOwnerKey = localStorage.getItem(SELECTED_KEY) || DEFAULT_OWNER_KEY;
  let currentRole = '';
  let selectedProfileIndex = 0;
  let registryCache = null;

  const rawFetch = window.fetch.bind(window);

  function workerBase() {
    return String(window.HYPN_CONFIG?.authWorkerUrl || '').replace(/\/$/, '');
  }

  function isWorkerUrl(value) {
    const worker = workerBase();
    return !!worker && String(value || '').startsWith(worker);
  }

  function sessionHeaders(extra = {}) {
    const token = sessionStorage.getItem(SESSION_KEY) || '';
    return token ? { ...extra, Authorization: 'Bearer ' + token } : extra;
  }

  function parseBody(init) {
    try {
      if (!init || !init.body || typeof init.body !== 'string') return null;
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  window.fetch = async function(input, init = {}) {
    let requestUrl = typeof input === 'string' ? input : input?.url;
    let nextInit = { ...init };

    if (isWorkerUrl(requestUrl)) {
      const url = new URL(requestUrl);
      const method = String(nextInit.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

      if (currentRole === 'owner' && selectedOwnerKey) {
        if (url.pathname === '/api/config' && method === 'GET') {
          url.searchParams.set('ownerKey', selectedOwnerKey);
        }

        if ((url.pathname === '/api/publish' || url.pathname === '/api/owner/approve') && method === 'POST') {
          const body = parseBody(nextInit);
          if (body && typeof body === 'object') {
            body.ownerKey = selectedOwnerKey;
            nextInit.body = JSON.stringify(body);
          }
        }
      }

      requestUrl = url.toString();
    }

    const response = await rawFetch(requestUrl, nextInit);

    try {
      if (isWorkerUrl(requestUrl)) {
        const url = new URL(requestUrl);
        if (url.pathname === '/api/me') {
          const data = await response.clone().json();
          currentRole = String(data?.role || '');
          if (currentRole !== 'owner') {
            selectedProfileIndex = -1;
          }
        }
      }
    } catch {}

    return response;
  };

  async function api(path, options = {}) {
    const worker = workerBase();
    if (!worker) throw new Error('Worker no configurado.');
    const response = await rawFetch(worker + path, {
      ...options,
      headers: sessionHeaders(options.headers || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  function activeOwner() {
    const owners = registryCache?.owners || [];
    return owners.find(o => o.key === selectedOwnerKey) || null;
  }

  function ownerImageBase() {
    if (!Number.isInteger(selectedProfileIndex) || selectedProfileIndex < 0) return '';
    return new URL(`owner-slots/slot-${String(selectedProfileIndex).padStart(2, '0')}/`, location.href).toString().replace(/\/$/, '');
  }

  function rewriteOwnerPreviews() {
    if (currentRole !== 'owner') return;

    const base = ownerImageBase();
    if (!base) return;

    document.querySelectorAll('#ownerPosterGrid .poster-card').forEach(card => {
      const metaText = card.querySelector('.poster-meta')?.textContent || '';
      const idMatch = metaText.match(/\b(?:salon|colab|fuera)_\d{2}\b/);
      const slotMatch = metaText.match(/Slot activo:\s*(-?\d+)/i);
      if (!idMatch || !slotMatch) return;

      const posterId = idMatch[0];
      const slot = Number(slotMatch[1]);
      const img = card.querySelector('.poster-preview img');
      const fallback = card.querySelector('.poster-fallback');
      if (!img) return;

      if (!Number.isInteger(slot) || slot < 0) {
        img.style.display = 'none';
        if (fallback) fallback.style.display = 'grid';
        return;
      }

      const wanted = `${base}/images/${posterId}/slot-${slot}.jpg?v=${Date.now()}`;
      if (img.dataset.hypnOwnerSrc !== wanted) {
        img.dataset.hypnOwnerSrc = wanted;
        img.src = wanted;
      }
    });
  }

  async function loadRegistry() {
    try {
      const data = await api('/api/owner/vrchat-owners');
      registryCache = data.registry || { owners: [] };
    } catch (error) {
      const publicUrl = new URL('vrchat-owners.json?v=' + Date.now(), location.href);
      const response = await rawFetch(publicUrl.toString(), { cache: 'no-store' });
      if (!response.ok) throw error;
      registryCache = await response.json();
    }

    const owners = Array.isArray(registryCache?.owners) ? registryCache.owners : [];
    let selected = owners.find(o => o.key === selectedOwnerKey && o.active !== false);
    if (!selected) {
      selected = owners.find(o => o.active !== false) || null;
      if (selected) {
        selectedOwnerKey = selected.key;
        localStorage.setItem(SELECTED_KEY, selectedOwnerKey);
      }
    }

    selectedProfileIndex = selected && Number.isInteger(Number(selected.profileIndex))
      ? Number(selected.profileIndex)
      : -1;

    return owners;
  }

  function buildPanel() {
    if (document.getElementById('hypnOwnerProfilesV1420')) return;

    const ownerArea = document.getElementById('ownerArea');
    if (!ownerArea) return;

    const card = document.createElement('section');
    card.id = 'hypnOwnerProfilesV1420';
    card.className = 'card';
    card.innerHTML = `
      <div class="section-title">
        <div>
          <h2>OWNER VRChat por instancia</h2>
          <p class="help">Cada nombre registrado tiene sus propias 15 imágenes. VRChat conserva el primer OWNER de la instancia y todos ven el perfil de esa persona.</p>
        </div>
        <div id="hypnOwnerProfilePill" class="pill">CARGANDO</div>
      </div>

      <div class="grid">
        <label>Perfil que estás editando
          <select id="hypnOwnerProfileSelect"></select>
        </label>
        <label>Registrar otro nombre exacto de VRChat
          <input id="hypnOwnerProfileName" maxlength="80" placeholder="ej. Nombre exacto en VRChat">
        </label>
      </div>

      <div class="row">
        <button id="hypnOwnerRegisterBtn" class="primary">REGISTRAR OWNER VRCHAT</button>
        <button id="hypnOwnerReloadBtn" class="ghost">RECARGAR PERFILES</button>
      </div>

      <div id="hypnOwnerProfileMsg" class="msg"></div>
      <div id="hypnOwnerProfileList" class="user-list"></div>
    `;

    ownerArea.insertBefore(card, ownerArea.firstChild);

    document.getElementById('hypnOwnerProfileSelect').addEventListener('change', event => {
      selectedOwnerKey = event.target.value;
      localStorage.setItem(SELECTED_KEY, selectedOwnerKey);
      location.reload();
    });

    document.getElementById('hypnOwnerReloadBtn').addEventListener('click', async () => {
      await refreshPanel();
    });

    document.getElementById('hypnOwnerRegisterBtn').addEventListener('click', async () => {
      const input = document.getElementById('hypnOwnerProfileName');
      const message = document.getElementById('hypnOwnerProfileMsg');
      const displayName = String(input.value || '').trim();

      if (!displayName) {
        message.textContent = 'Escribe el nombre exacto de VRChat.';
        message.className = 'msg error';
        return;
      }

      try {
        message.textContent = 'Registrando perfil...';
        message.className = 'msg';
        const data = await api('/api/owner/vrchat-owners/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName })
        });

        selectedOwnerKey = data.owner.key;
        localStorage.setItem(SELECTED_KEY, selectedOwnerKey);
        input.value = '';
        message.textContent = `${data.owner.displayName} registrado. Perfil ${Number(data.owner.profileIndex) + 1}.`;
        message.className = 'msg ok';
        location.reload();
      } catch (error) {
        message.textContent = error.message;
        message.className = 'msg error';
      }
    });
  }

  async function toggleOwner(key, active) {
    const message = document.getElementById('hypnOwnerProfileMsg');
    try {
      await api('/api/owner/vrchat-owners/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, active })
      });
      if (message) {
        message.textContent = active ? 'OWNER activado.' : 'OWNER desactivado.';
        message.className = 'msg ok';
      }
      await refreshPanel();
    } catch (error) {
      if (message) {
        message.textContent = error.message;
        message.className = 'msg error';
      }
    }
  }

  function renderPanel(owners) {
    const select = document.getElementById('hypnOwnerProfileSelect');
    const pill = document.getElementById('hypnOwnerProfilePill');
    const list = document.getElementById('hypnOwnerProfileList');
    if (!select || !pill || !list) return;

    const activeOwners = owners.filter(o => o.active !== false);
    select.innerHTML = activeOwners.map(owner => `
      <option value="${escapeHtml(owner.key)}" ${owner.key === selectedOwnerKey ? 'selected' : ''}>
        ${escapeHtml(owner.displayName)} • Perfil ${Number(owner.profileIndex) + 1}
      </option>
    `).join('');

    const selected = activeOwner();
    if (selected) {
      pill.textContent = `EDITANDO: ${selected.displayName}`;
      pill.className = 'pill ok';
    } else {
      pill.textContent = 'SIN OWNER ACTIVO';
      pill.className = 'pill bad';
    }

    list.innerHTML = owners.length ? owners.map(owner => `
      <div class="user-card">
        <div class="user-head">
          <strong>${escapeHtml(owner.displayName)}</strong>
          <span class="pill ${owner.active !== false ? 'ok' : 'bad'}">${owner.active !== false ? 'ACTIVO' : 'DESACTIVADO'}</span>
        </div>
        <div class="muted">Perfil fijo ${Number(owner.profileIndex) + 1} • ${escapeHtml(owner.key)}</div>
        <div class="user-actions">
          <button class="${owner.active !== false ? 'danger' : 'ok'} small hypn-owner-toggle"
                  data-key="${escapeHtml(owner.key)}"
                  data-active="${owner.active !== false ? '0' : '1'}">
            ${owner.active !== false ? 'DESACTIVAR' : 'ACTIVAR'}
          </button>
        </div>
      </div>
    `).join('') : '<div class="muted">No hay OWNER VRChat registrados.</div>';

    list.querySelectorAll('.hypn-owner-toggle').forEach(button => {
      button.addEventListener('click', () => {
        toggleOwner(button.dataset.key, button.dataset.active === '1');
      });
    });

    rewriteOwnerPreviews();
  }

  async function refreshPanel() {
    const message = document.getElementById('hypnOwnerProfileMsg');
    try {
      const owners = await loadRegistry();
      renderPanel(owners);
      if (message && !message.textContent) {
        message.textContent = `Sincronización por instancia activa • ${owners.length} OWNER registrado${owners.length === 1 ? '' : 's'}.`;
        message.className = 'msg ok';
      }
    } catch (error) {
      if (message) {
        message.textContent = 'No se pudo cargar el registro OWNER: ' + error.message;
        message.className = 'msg error';
      }
    }
  }

  function bootUi() {
    buildPanel();
    refreshPanel();

    const observer = new MutationObserver(() => {
      rewriteOwnerPreviews();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      buildPanel();
      rewriteOwnerPreviews();
    }, 1200);
  }

  document.addEventListener('DOMContentLoaded', bootUi);

  window.HYPN_OWNER_PROFILES = {
    version: VERSION,
    get selectedOwnerKey() { return selectedOwnerKey; },
    get selectedProfileIndex() { return selectedProfileIndex; },
    defaultOwnerName: DEFAULT_OWNER_NAME
  };
})();
