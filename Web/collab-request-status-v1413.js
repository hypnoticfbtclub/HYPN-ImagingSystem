(() => {
  const VERSION = '1.4.13';
  const TOAST_TTL = 5200;
  const ADMIN_POLL_MS = 20000;
  const recentSendCards = new WeakSet();
  const notifiedMessages = new WeakMap();
  let adminBaselineReady = false;
  let knownAdminPendingIds = new Set();
  let adminPollRunning = false;

  const style = document.createElement('style');
  style.id = 'hypn-request-status-v1413-style';
  style.textContent = `
    #collabPosterGrid .badge.hypn-pending{
      color:#ffe08b!important;background:#3d300f!important;border-color:#8f7130!important
    }
    #collabPosterGrid .badge.hypn-approved{
      color:#8ff0b7!important;background:#133521!important;border-color:#347653!important
    }
    #collabPosterGrid .badge.hypn-rejected{
      color:#ff9aa2!important;background:#35151b!important;border-color:#963b49!important
    }

    .hypn-toast-stack{
      position:fixed;z-index:99999;top:18px;right:18px;width:min(420px,calc(100vw - 36px));
      display:grid;gap:10px;pointer-events:none
    }
    .hypn-toast{
      pointer-events:auto;border-radius:16px;padding:14px 16px;border:1px solid var(--line,#30303d);
      background:rgba(16,16,23,.97);box-shadow:0 18px 48px rgba(0,0,0,.42);
      display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;
      animation:hypnToastIn .22s ease-out
    }
    .hypn-toast.pending{border-color:#8f7130;background:rgba(48,39,14,.98)}
    .hypn-toast.approved{border-color:#347653;background:rgba(15,48,31,.98)}
    .hypn-toast.rejected{border-color:#963b49;background:rgba(55,18,24,.98)}
    .hypn-toast .hypn-toast-icon{font-size:22px;line-height:1}
    .hypn-toast .hypn-toast-title{font-size:13px;font-weight:950;margin-bottom:4px}
    .hypn-toast .hypn-toast-text{font-size:12px;line-height:1.45;color:#d7d7df}
    .hypn-toast button{pointer-events:auto;background:transparent!important;border:0!important;color:#aaaaba!important;padding:0!important;font-size:18px!important}
    .hypn-toast.hiding{opacity:0;transform:translateY(-8px);transition:.2s ease}
    @keyframes hypnToastIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}

    .hypn-admin-pending-count{margin-left:8px;vertical-align:middle}
    .hypn-admin-pending-count.zero{color:#aaaaba;border-color:#3a3a48;background:#20202a}
    .hypn-admin-pending-count.has{color:#ffe08b;border-color:#8f7130;background:#3d300f}
  `;
  document.head.appendChild(style);

  function toastStack() {
    let stack = document.getElementById('hypnToastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'hypnToastStack';
      stack.className = 'hypn-toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(kind, title, text) {
    const icons = { pending: '⏳', approved: '✓', rejected: '✕' };
    const el = document.createElement('div');
    el.className = `hypn-toast ${kind}`;
    el.innerHTML = `
      <div class="hypn-toast-icon">${icons[kind] || '•'}</div>
      <div><div class="hypn-toast-title">${escapeHtml(title)}</div><div class="hypn-toast-text">${escapeHtml(text)}</div></div>
      <button type="button" aria-label="Cerrar">×</button>`;
    const close = () => {
      if (!el.isConnected) return;
      el.classList.add('hiding');
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('button').onclick = close;
    toastStack().appendChild(el);
    setTimeout(close, TOAST_TTL);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[ch]));
  }

  function rawStatus(badge) {
    if (!badge) return '';
    if (!badge.dataset.hypnRequestOriginal) {
      badge.dataset.hypnRequestOriginal = String(
        badge.dataset.hypnOriginalStatus || badge.textContent || ''
      ).trim();
    }
    return badge.dataset.hypnRequestOriginal.toUpperCase();
  }

  function classifyStatus(text) {
    const t = String(text || '').toUpperCase();
    if (t.includes('PENDIENTE')) {
      return { kind:'pending', icon:'⏳', label:'PENDIENTE' };
    }
    if (t.includes('RECHAZ') || t.includes('SIN SOLICITUD') || t.includes('NO APROB') || t.includes('SIN APROBAR')) {
      return { kind:'rejected', icon:'✕', label:t.includes('RECHAZ') ? 'RECHAZADO' : 'NO APROBADO' };
    }
    if (t.includes('APROB')) {
      return { kind:'approved', icon:'✓', label:'APROBADO' };
    }
    return { kind:'rejected', icon:'✕', label:'NO APROBADO' };
  }

  function decorateCollaboratorCard(card) {
    const badge = card.querySelector('.badge');
    if (!badge) return;

    // V1.4.13: solo mostramos UN estado, junto al título del cartel.
    // Eliminamos cualquier indicador duplicado que pudiera estar sobre la imagen.
    card.querySelectorAll('.hypn-request-overlay, .hypn-approval-overlay, .hypn-pending-overlay').forEach(el => el.remove());

    const state = classifyStatus(rawStatus(badge));
    badge.classList.remove('ok','warn','bad','neutral','approval-green','approval-red','hypn-pending','hypn-approved','hypn-rejected');
    badge.classList.add(`hypn-${state.kind}`);
    badge.innerHTML = `<span style="font-weight:950;margin-right:5px">${state.icon}</span>${state.label}`;
  }

  function cleanAdminVisuals() {
    document.querySelectorAll('#ownerArea .hypn-request-overlay, #ownerArea .hypn-approval-overlay, #ownerArea .hypn-pending-overlay').forEach(el => el.remove());
  }

  function updateAdminPendingCount() {
    const pendingList = document.getElementById('pendingList');
    if (!pendingList) return;
    const sectionTitle = pendingList.closest('.card')?.querySelector('.section-title h2');
    if (!sectionTitle) return;

    let pill = document.getElementById('hypnAdminPendingCount');
    if (!pill) {
      pill = document.createElement('span');
      pill.id = 'hypnAdminPendingCount';
      pill.className = 'pill hypn-admin-pending-count zero';
      sectionTitle.insertAdjacentElement('afterend', pill);
    }

    let count = 0;
    try {
      if (typeof pendingSubmissions !== 'undefined' && Array.isArray(pendingSubmissions)) {
        count = pendingSubmissions.length;
      } else {
        count = pendingList.querySelectorAll('.approval-card').length;
      }
    } catch {
      count = pendingList.querySelectorAll('.approval-card').length;
    }
    pill.textContent = count ? `${count} PENDIENTE${count === 1 ? '' : 'S'}` : '0 PENDIENTES';
    pill.className = `pill hypn-admin-pending-count ${count ? 'has' : 'zero'}`;
  }

  function apply() {
    cleanAdminVisuals();
    document.querySelectorAll('#collabPosterGrid .poster-card').forEach(decorateCollaboratorCard);
    updateAdminPendingCount();
    const footer = document.querySelector('footer');
    if (footer) footer.textContent = `HYPN Imaging System V${VERSION} • Pendiente = amarillo • Aprobado = verde • Rechazado/No aprobado = rojo`;
  }

  document.addEventListener('click', event => {
    const send = event.target.closest('#collabPosterGrid .poster-card .send');
    if (!send) return;
    const card = send.closest('.poster-card');
    if (card) recentSendCards.add(card);
  }, true);

  function detectSubmissionConfirmation() {
    document.querySelectorAll('#collabPosterGrid .poster-card .card-msg').forEach(messageEl => {
      const card = messageEl.closest('.poster-card');
      const text = String(messageEl.textContent || '').trim();
      if (!card || !recentSendCards.has(card) || !/solicitud/i.test(text) || !/enviad/i.test(text)) return;
      if (notifiedMessages.get(messageEl) === text) return;
      notifiedMessages.set(messageEl, text);
      recentSendCards.delete(card);

      const posterName = card.querySelector('.poster-head h3')?.textContent?.trim() || 'este cartel';
      showToast(
        'pending',
        'SOLICITUD DE IMAGEN ENVIADA',
        `${posterName}: la solicitud fue enviada correctamente y está pendiente de aprobación del ADMIN.`
      );

      const globalMsg = document.getElementById('collabSubmitMsg');
      if (globalMsg) {
        globalMsg.textContent = `Solicitud de imagen enviada correctamente para ${posterName}. Pendiente de aprobación del ADMIN.`;
        globalMsg.className = 'msg warn';
      }
    });
  }

  async function pollAdminPending() {
    if (adminPollRunning) return;
    let isAdmin = false;
    try { isAdmin = typeof me !== 'undefined' && me?.role === 'owner'; } catch {}
    if (!isAdmin || typeof loadPending !== 'function') {
      adminBaselineReady = false;
      knownAdminPendingIds = new Set();
      return;
    }

    adminPollRunning = true;
    try {
      if (!adminBaselineReady) {
        try {
          const current = Array.isArray(pendingSubmissions) ? pendingSubmissions : [];
          knownAdminPendingIds = new Set(current.map(x => String(x.id ?? `${x.user_id}:${x.poster_id}:${x.created_at}`)));
        } catch { knownAdminPendingIds = new Set(); }
        adminBaselineReady = true;
      }

      await loadPending();
      let current = [];
      try { current = Array.isArray(pendingSubmissions) ? pendingSubmissions : []; } catch {}
      const currentIds = new Set(current.map(x => String(x.id ?? `${x.user_id}:${x.poster_id}:${x.created_at}`)));
      const newItems = current.filter(x => !knownAdminPendingIds.has(String(x.id ?? `${x.user_id}:${x.poster_id}:${x.created_at}`)));

      if (newItems.length) {
        const first = newItems[0];
        const who = first.username || first.user_name || first.login || 'Un colaborador';
        const poster = first.poster_id || 'un cartel';
        showToast(
          'pending',
          newItems.length === 1 ? 'NUEVA SOLICITUD DE IMAGEN' : `${newItems.length} NUEVAS SOLICITUDES`,
          newItems.length === 1
            ? `${who} envió una imagen para ${poster}. Está pendiente de tu aprobación.`
            : `Tienes ${newItems.length} solicitudes nuevas pendientes de aprobación.`
        );
      }
      knownAdminPendingIds = currentIds;
      updateAdminPendingCount();
    } catch {}
    finally { adminPollRunning = false; }
  }

  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      detectSubmissionConfirmation();
      apply();
    });
  }

  new MutationObserver(scheduleApply).observe(document.documentElement, {
    childList:true, subtree:true, characterData:true
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once:true });
  } else {
    apply();
  }

  setInterval(pollAdminPending, ADMIN_POLL_MS);
  setTimeout(pollAdminPending, 2500);
})();
