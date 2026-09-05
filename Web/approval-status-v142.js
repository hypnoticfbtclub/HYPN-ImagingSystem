(() => {
  const VERSION = '1.4.3';

  const style = document.createElement('style');
  style.id = 'hypn-approval-v143-style';
  style.textContent = `
    .poster-preview{position:relative}
    .hypn-approval-overlay{
      position:absolute;z-index:20;top:12px;right:12px;
      display:inline-flex;align-items:center;gap:7px;
      padding:9px 12px;border-radius:999px;
      font-size:11px;font-weight:950;letter-spacing:.02em;
      border:1px solid;box-shadow:0 8px 24px rgba(0,0,0,.32);
      backdrop-filter:blur(8px);pointer-events:none
    }
    .hypn-approval-overlay.approved{
      color:#8ff0b7;background:rgba(15,52,33,.94);border-color:#347653
    }
    .hypn-approval-overlay.unapproved{
      color:#ff9aa2;background:rgba(68,20,27,.95);border-color:#963b49
    }
    .hypn-approval-icon{
      width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;
      font-size:13px;font-weight:950;line-height:1
    }
    .approved .hypn-approval-icon{background:#1d6a43;color:white}
    .unapproved .hypn-approval-icon{background:#a63142;color:white}
    .badge.approval-green{color:#8ff0b7!important;background:#133521!important;border-color:#347653!important}
    .badge.approval-red{color:#ff9aa2!important;background:#35151b!important;border-color:#963b49!important}
    .approval-card{position:relative}
    .approval-card .hypn-pending-overlay{
      position:absolute;z-index:10;top:24px;right:24px;
      display:inline-flex;align-items:center;gap:6px;padding:8px 11px;border-radius:999px;
      color:#ff9aa2;background:rgba(68,20,27,.95);border:1px solid #963b49;
      font-size:11px;font-weight:950;pointer-events:none
    }
  `;
  document.head.appendChild(style);

  function classify(text) {
    const t = String(text || '').trim().toUpperCase();
    if (t.includes('APROBADA') || t.includes('APROBADO') || t.includes('PUBLICADO')) {
      return { approved: true, label: 'APROBADA', icon: '✓' };
    }
    if (t.includes('PENDIENTE') || t.includes('SIN SOLICITUD') || t.includes('RECHAZADA') || t.includes('NO APROBADA') || t.includes('SIN APROBAR')) {
      return { approved: false, label: 'AÚN NO APROBADA', icon: '✕' };
    }
    return null;
  }

  function setVisualState(preview, badge, state) {
    let overlay = preview.querySelector('.hypn-approval-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'hypn-approval-overlay';
      preview.appendChild(overlay);
    }

    overlay.className = `hypn-approval-overlay ${state.approved ? 'approved' : 'unapproved'}`;
    overlay.innerHTML = `<span class="hypn-approval-icon">${state.icon}</span><span>${state.label}</span>`;

    badge.classList.remove('approval-green', 'approval-red');
    badge.classList.add(state.approved ? 'approval-green' : 'approval-red');
    badge.innerHTML = `<span style="font-weight:950;margin-right:5px">${state.icon}</span>${state.label}`;
  }

  function decoratePoster(card) {
    const preview = card.querySelector('.poster-preview');
    const badge = card.querySelector('.badge');
    const img = preview?.querySelector('img');
    if (!preview || !badge || !img) return;

    if (!badge.dataset.hypnOriginalStatus) {
      badge.dataset.hypnOriginalStatus = badge.textContent || '';
    }

    if (!img.dataset.hypnApprovalWatch) {
      img.dataset.hypnApprovalWatch = '1';
      img.addEventListener('load', scheduleApply);
      img.addEventListener('error', scheduleApply);
    }

    // Mientras la imagen aún está cargando no decidimos el estado.
    if (!img.complete) return;

    const baseState = classify(badge.dataset.hypnOriginalStatus);
    if (!baseState) return;

    // Regla principal V1.4.3:
    // si el archivo de imagen no existe o no pudo cargarse, NUNCA se marca como aprobada.
    const imageExists = img.naturalWidth > 0 && img.naturalHeight > 0;
    const finalState = (!imageExists)
      ? { approved: false, label: 'AÚN NO APROBADA', icon: '✕' }
      : baseState;

    setVisualState(preview, badge, finalState);
  }

  function decoratePendingCard(card) {
    if (!card.querySelector('img')) return;
    if (card.querySelector('.hypn-pending-overlay')) return;
    const el = document.createElement('div');
    el.className = 'hypn-pending-overlay';
    el.innerHTML = '<span>✕</span><span>AÚN NO APROBADA</span>';
    card.appendChild(el);
  }

  function apply() {
    document.querySelectorAll('.poster-card').forEach(decoratePoster);
    document.querySelectorAll('.approval-card').forEach(decoratePendingCard);

    const footer = document.querySelector('footer');
    if (footer) {
      footer.dataset.approvalV143 = '1';
      footer.textContent = `HYPN Remote Image System V${VERSION} • ✓ APROBADA / ✕ AÚN NO APROBADA • aprobación OWNER`;
    }
  }

  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  setInterval(apply, 1500);
})();
