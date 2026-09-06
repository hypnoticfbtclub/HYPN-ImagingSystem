(() => {
  const VERSION = '1.4.18';
  let loadedForSession = false;
  let lastToken = '';

  function el(id) { return document.getElementById(id); }

  function installPanel() {
    const ownerArea = el('ownerArea');
    if (!ownerArea || el('adminVrchatIdentityCard')) return;

    const card = document.createElement('section');
    card.id = 'adminVrchatIdentityCard';
    card.className = 'card';
    card.innerHTML = `
      <div class="section-title">
        <div>
          <h2>Identidad VRChat del ADMIN</h2>
          <p class="help">Escribe tu nombre exacto de VRChat. Unity comparará este valor con tu nombre dentro del mundo para detectarte y forzar una resincronización. Esto NO limita las imágenes: todos los jugadores seguirán viendo los mismos carteles.</p>
        </div>
      </div>
      <div class="grid">
        <label>Nombre exacto en VRChat
          <input id="adminVrchatName" maxlength="80" placeholder="ej. TuNombreExactoEnVRChat">
        </label>
      </div>
      <div class="stats">
        <div><span>ADMIN VRChat guardado</span><strong id="adminVrchatSavedStat">NO CONFIGURADO</strong></div>
        <div><span>Uso en Unity</span><strong>DETECCIÓN + RESINCRONIZACIÓN</strong></div>
        <div><span>Visibilidad</span><strong>GLOBAL PARA TODOS</strong></div>
      </div>
      <div class="row"><button id="saveAdminVrchatBtn" class="primary">GUARDAR NOMBRE VRCHAT</button></div>
      <div id="adminVrchatMsg" class="msg"></div>`;

    ownerArea.insertBefore(card, ownerArea.firstChild);
  }

  function setMsg(text, kind = '') {
    const node = el('adminVrchatMsg');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function setSavedName(name) {
    const field = el('adminVrchatName');
    const stat = el('adminVrchatSavedStat');
    if (field && document.activeElement !== field) field.value = name || '';
    if (stat) stat.textContent = name || 'NO CONFIGURADO';
  }

  async function loadName() {
    if (typeof api !== 'function') return;
    try {
      const data = await api('/api/owner/vrchat-admin');
      setSavedName(data.adminVrchatName || '');
      setMsg(
        data.adminVrchatName
          ? 'Nombre VRChat guardado. Unity lo comparará con Networking.LocalPlayer.displayName.'
          : 'Aún no has configurado el nombre exacto de VRChat del ADMIN.',
        data.adminVrchatName ? 'ok' : 'warn'
      );
      loadedForSession = true;
    } catch (err) {
      setMsg(err.message || String(err), 'error');
    }
  }

  async function saveName() {
    const field = el('adminVrchatName');
    const button = el('saveAdminVrchatBtn');
    if (!field || !button || typeof api !== 'function') return;

    const adminVrchatName = field.value.trim();
    if (!adminVrchatName) {
      setMsg('Escribe tu nombre exacto de VRChat.', 'warn');
      field.focus();
      return;
    }

    button.disabled = true;
    try {
      setMsg('Guardando identidad de VRChat...', '');
      const data = await api('/api/owner/vrchat-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminVrchatName })
      });
      setSavedName(data.adminVrchatName || adminVrchatName);
      setMsg('ADMIN VRChat guardado correctamente. Al entrar al mundo, Unity podrá detectarte y forzar la resincronización.', 'ok');
      if (typeof loadConfig === 'function') {
        try { await loadConfig(); } catch {}
      }
    } catch (err) {
      setMsg(err.message || String(err), 'error');
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    installPanel();

    const button = el('saveAdminVrchatBtn');
    if (button && !button.dataset.hypnBound) {
      button.dataset.hypnBound = '1';
      button.addEventListener('click', saveName);
    }

    const field = el('adminVrchatName');
    if (field && !field.dataset.hypnBound) {
      field.dataset.hypnBound = '1';
      field.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveName();
        }
      });
    }
  }

  function tick() {
    bind();

    const token = typeof sessionToken === 'string' ? sessionToken : '';
    if (token !== lastToken) {
      lastToken = token;
      loadedForSession = false;
    }

    const isAdmin = typeof me !== 'undefined' && me && me.role === 'owner';
    const ownerVisible = el('ownerArea') && el('ownerArea').style.display !== 'none';

    if (isAdmin && ownerVisible && token && !loadedForSession) {
      loadName();
    }
  }

  installPanel();
  bind();
  setInterval(tick, 800);

  const footer = document.querySelector('footer');
  if (footer) {
    footer.textContent = `HYPN Imaging System V${VERSION} • ADMIN VRChat vinculado • imágenes globales para todos`;
  }
})();
