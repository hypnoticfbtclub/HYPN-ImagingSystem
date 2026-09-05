(() => {
  const VERSION = '1.4.7';
  const PLACEHOLDER_MAX = 32;

  const style = document.createElement('style');
  style.id = 'hypn-approval-v147-style';
  style.textContent = `
    #collabPosterGrid .poster-preview{position:relative}
    #collabPosterGrid .hypn-approval-overlay{
      position:absolute;z-index:20;top:12px;right:12px;
      display:inline-flex;align-items:center;gap:7px;
      padding:9px 12px;border-radius:999px;
      font-size:11px;font-weight:950;letter-spacing:.02em;
      border:1px solid;box-shadow:0 8px 24px rgba(0,0,0,.32);
      backdrop-filter:blur(8px);pointer-events:none
    }
    #collabPosterGrid .hypn-approval-overlay.approved{
      color:#8ff0b7;background:rgba(15,52,33,.94);border-color:#347653
    }
    #collabPosterGrid .hypn-approval-overlay.unapproved{
      color:#ff9aa2;background:rgba(68,20,27,.95);border-color:#963b49
    }
    #collabPosterGrid .hypn-approval-icon{
      width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;
      font-size:13px;font-weight:950;line-height:1
    }
    #collabPosterGrid .approved .hypn-approval-icon{background:#1d6a43;color:white}
    #collabPosterGrid .unapproved .hypn-approval-icon{background:#a63142;color:white}
    #collabPosterGrid .badge.approval-green{color:#8ff0b7!important;background:#133521!important;border-color:#347653!important}
    #collabPosterGrid .badge.approval-red{color:#ff9aa2!important;background:#35151b!important;border-color:#963b49!important}
  `;
  document.head.appendChild(style);

  function textSaysUnapproved(text) {
    const t = String(text || '').trim().toUpperCase();
    return t.includes('PENDIENTE') || t.includes('SIN SOLICITUD') || t.includes('RECHAZADA') || t.includes('NO APROBADA') || t.includes('SIN APROBAR') || t.includes('AÚN NO APROBADA');
  }

  function hasRealImage(img) {
    if (!img || !img.complete) return null;
    if (!img.naturalWidth || !img.naturalHeight) return false;
    return img.naturalWidth > PLACEHOLDER_MAX || img.naturalHeight > PLACEHOLDER_MAX;
  }

  function setState(preview, badge, approved) {
    let overlay = preview.querySelector('.hypn-approval-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'hypn-approval-overlay';
      preview.appendChild(overlay);
    }

    const label = approved ? 'APROBADA' : 'AÚN NO APROBADA';
    const icon = approved ? '✓' : '✕';
    overlay.className = `hypn-approval-overlay ${approved ? 'approved' : 'unapproved'}`;
    overlay.innerHTML = `<span class="hypn-approval-icon">${icon}</span><span>${label}</span>`;

    badge.classList.remove('approval-green', 'approval-red', 'ok', 'warn', 'bad', 'neutral');
    badge.classList.add(approved ? 'approval-green' : 'approval-red');
    badge.innerHTML = `<span style="font-weight:950;margin-right:5px">${icon}</span>${label}`;
  }

  function decorateCollaboratorPoster(card) {
    const preview = card.querySelector('.poster-preview');
    const badge = card.querySelector('.badge');
    const img = preview?.querySelector('img');
    if (!preview || !badge || !img) return;

    if (!badge.dataset.hypnOriginalStatus) badge.dataset.hypnOriginalStatus = badge.textContent || '';

    if (!img.dataset.hypnApprovalBound) {
      img.dataset.hypnApprovalBound = '1';
      img.addEventListener('load', () => decorateCollaboratorPoster(card));
      img.addEventListener('error', () => decorateCollaboratorPoster(card));
    }

    const originalStatus = badge.dataset.hypnOriginalStatus;
    if (textSaysUnapproved(originalStatus)) {
      setState(preview, badge, false);
      return;
    }

    const realImage = hasRealImage(img);
    if (realImage === null) return;
    setState(preview, badge, realImage === true);
  }

  function cleanupOwnerApprovalDecorations() {
    document.querySelectorAll('#ownerArea .hypn-approval-overlay, #ownerArea .hypn-pending-overlay').forEach(el => el.remove());
    document.querySelectorAll('#ownerPosterGrid .badge').forEach(badge => {
      if (badge.dataset.hypnOriginalStatus) {
        badge.textContent = badge.dataset.hypnOriginalStatus;
        delete badge.dataset.hypnOriginalStatus;
      }
      badge.classList.remove('approval-green', 'approval-red');
    });
  }

  function apply() {
    cleanupOwnerApprovalDecorations();
    document.querySelectorAll('#collabPosterGrid .poster-card').forEach(decorateCollaboratorPoster);
    const footer = document.querySelector('footer');
    if (footer) footer.textContent = `HYPN Remote Image System V${VERSION} • OWNER publica directo • aprobación visible solo para colaboradores`;
  }

  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; apply(); });
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  setInterval(apply, 1500);
})();
