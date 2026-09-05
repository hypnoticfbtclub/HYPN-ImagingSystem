(() => {
  const V = '1.4.0';
  const GROUP_ORDER = ['salon_principal','colaboradores','fuera_club'];
  const GROUP_LABEL = { salon_principal:'Salón Principal', colaboradores:'Colaboradores', fuera_club:'Fuera del Club' };
  let ownerTab = 'salon_principal';
  let collabTab = 'salon_principal';
  let ownerPending = [];
  let collabMine = [];
  let mountedOwner = false;
  let mountedCollab = false;

  const style = document.createElement('style');
  style.id = 'hypn-v14-style';
  style.textContent = `
    .hypn-tabs{display:flex;gap:9px;flex-wrap:wrap;margin:8px 0 18px}.hypn-tab{background:#181821;color:#d7d7e1;border:1px solid #30303d;border-radius:999px;padding:10px 14px;font-size:13px;font-weight:900;cursor:pointer}.hypn-tab.active{background:#2a2314;border-color:#7a6330;color:#ffe19b}
    .hypn-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.hypn-poster{background:linear-gradient(180deg,#11111a,#0f0f16);border:1px solid #30303d;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;min-height:420px}.hypn-preview{position:relative;aspect-ratio:1/1;background:#12121a;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid #30303d}.hypn-preview:before{content:'';position:absolute;inset:0;background:linear-gradient(45deg,#181820 25%,transparent 25%,transparent 75%,#181820 75%),linear-gradient(45deg,#181820 25%,transparent 25%,transparent 75%,#181820 75%);background-size:28px 28px;background-position:0 0,14px 14px}.hypn-preview img{position:relative;z-index:2;width:100%;height:100%;object-fit:contain;background:#07070b}.hypn-fallback{position:absolute;z-index:3;inset:0;display:grid;place-items:center;text-align:center;padding:20px;font-size:19px;font-weight:900}.hypn-fallback small{display:block;color:#aaaaba;font-size:12px;margin-top:8px}.hypn-body{padding:16px;display:grid;gap:10px;flex:1}.hypn-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.hypn-head h3{font-size:18px;line-height:1.15;margin:0}.hypn-badge{display:inline-flex;border:1px solid #30303d;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:900;white-space:nowrap}.hypn-badge.ok{color:#6ee7a2;background:#13271d;border-color:#2e6045}.hypn-badge.warn{color:#ffd16e;background:#2b2514;border-color:#6a582d}.hypn-badge.bad{color:#ff6f78;background:#2b1519;border-color:#6a2730}.hypn-badge.neutral{color:#c6c6d4;background:#20202a}.hypn-meta{display:grid;gap:5px;color:#b8b8c5;font-size:12px}.hypn-note{font-size:12px;color:#aaaaba;line-height:1.4;min-height:36px}.hypn-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto}.hypn-actions input{display:none}.hypn-cardmsg{font-size:12px;min-height:18px;color:#aaaaba}.hypn-cardmsg.ok{color:#6ee7a2}.hypn-cardmsg.err{color:#ff6f78}.hypn-empty{border:1px dashed #30303d;border-radius:14px;padding:22px;color:#aaaaba}.hypn-area-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:4px}.hypn-area-head p{color:#aaaaba;font-size:14px;line-height:1.45}.hypn-refresh{padding:8px 11px!important;font-size:12px!important}
    @media(max-width:1000px){.hypn-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.hypn-gallery{grid-template-columns:1fr}.hypn-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  function q(id){ return document.getElementById(id); }
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function cfg(){ try { return remoteConfig || null; } catch { return null; } }
  function user(){ try { return me || null; } catch { return null; } }
  function slot(id){ return Number(cfg()?.channels?.[id] ?? 0); }
  function base(){ return new URL('.', location.href).toString().replace(/\/$/,''); }
  function imageUrl(id){ return `${base()}/images/${encodeURIComponent(id)}/slot-${slot(id)}.jpg?v=${encodeURIComponent(cfg()?.version || Date.now())}`; }
  function groups(){ try { return GROUPS; } catch { return {}; } }
  function meta(){ try { return META; } catch { return {}; } }
  function groupIds(group){ return groups()?.[group]?.ids || []; }
  function permissions(){ return Array.isArray(user()?.permissions) ? user().permissions : []; }
  function allowedGroups(){ return GROUP_ORDER.filter(g=>groupIds(g).some(id=>permissions().includes(id))); }

  async function fetchPending(){
    try { const d = await workerFetch('/api/owner/submissions?status=pending'); ownerPending = d.submissions || []; } catch { ownerPending = []; }
  }
  async function fetchMine(){
    try { const d = await workerFetch('/api/collab/submissions'); collabMine = d.submissions || []; } catch { collabMine = []; }
  }
  function latestMine(id){ return collabMine.find(x=>x.poster_id===id) || null; }
  function ownerStatus(id){ const n = ownerPending.filter(x=>x.poster_id===id).length; return n ? {c:'warn',t:`${n} PENDIENTE${n>1?'S':''}`,d:`${n} solicitud${n>1?'es':''} esperando aprobación.`} : {c:'ok',t:'PUBLICADO',d:'Imagen actualmente publicada. Puedes reemplazarla desde este cuadro.'}; }
  function collabStatus(id){
    const x = latestMine(id);
    if(!x) return {c:'neutral',t:'SIN SOLICITUD',d:'Todavía no has enviado una imagen para este cartel.'};
    if(x.status==='pending') return {c:'warn',t:'PENDIENTE',d:`Enviada: ${fmt(x.created_at)}`};
    if(x.status==='approved') return {c:'ok',t:'APROBADA',d:`Publicada por OWNER${x.published_slot!=null?` en slot ${x.published_slot}`:''}.`};
    return {c:'bad',t:'RECHAZADA',d:x.reject_reason?`Motivo: ${x.reject_reason}`:`Revisada: ${fmt(x.reviewed_at || x.created_at)}`};
  }
  function fmt(v){ if(!v) return '—'; try{return new Date(v).toLocaleString();}catch{return String(v);} }

  function tabBar(target, active, allowed, onChange){
    target.innerHTML = allowed.map(g=>`<button class="hypn-tab ${g===active?'active':''}" data-g="${g}">${esc(GROUP_LABEL[g])} • ${groupIds(g).filter(id=>!user()||user().role==='owner'||permissions().includes(id)).length}</button>`).join('');
    target.querySelectorAll('.hypn-tab').forEach(b=>b.addEventListener('click',()=>onChange(b.dataset.g)));
  }

  function card(poster, mode, state){
    const c = document.createElement('article');
    c.className = 'hypn-poster';
    c.innerHTML = `<div class="hypn-preview"><img src="${imageUrl(poster.id)}" alt="${esc(poster.label)}"><div class="hypn-fallback">${esc(poster.label)}<small>${esc(poster.id)}</small></div></div><div class="hypn-body"><div class="hypn-head"><h3>${esc(poster.label)}</h3><span class="hypn-badge ${state.c}">${esc(state.t)}</span></div><div class="hypn-meta"><div><strong>ID:</strong> ${esc(poster.id)}</div><div><strong>Slot activo:</strong> ${slot(poster.id)}</div></div><div class="hypn-note">${esc(state.d)}</div><div class="hypn-actions"><input class="hypn-file" type="file" accept="image/jpeg,image/png,image/webp"><button class="ghost small pick">ELEGIR IMAGEN</button><button class="${mode==='owner'?'primary':'ok'} small send" disabled>${mode==='owner'?'PUBLICAR':'ENVIAR'}</button></div><div class="hypn-cardmsg"></div></div>`;
    const img=c.querySelector('img'), fb=c.querySelector('.hypn-fallback'), file=c.querySelector('.hypn-file'), pick=c.querySelector('.pick'), send=c.querySelector('.send'), cm=c.querySelector('.hypn-cardmsg');
    img.addEventListener('load',()=>{img.style.display='block';fb.style.display='none';}); img.addEventListener('error',()=>{img.style.display='none';fb.style.display='grid';});
    pick.addEventListener('click',()=>file.click());
    file.addEventListener('change',async()=>{
      const f=file.files[0]; if(!f){c._blob=null;send.disabled=true;img.src=imageUrl(poster.id);return;}
      try{ cm.textContent='Preparando imagen...'; cm.className='hypn-cardmsg'; c._blob=await fileToJpegBlob(f,mode==='owner'?2048:1600,mode==='owner'?2100000:650000); send.disabled=false; img.src=URL.createObjectURL(c._blob); img.style.display='block';fb.style.display='none';cm.textContent=`Lista (${Math.round(c._blob.size/1024)} KB).`;cm.className='hypn-cardmsg ok'; }
      catch(e){c._blob=null;send.disabled=true;cm.textContent=e.message;cm.className='hypn-cardmsg err';}
    });
    send.addEventListener('click',async()=>{
      if(!c._blob) return; send.disabled=true;
      try{
        cm.textContent=mode==='owner'?'Publicando...':'Enviando para aprobación...'; cm.className='hypn-cardmsg';
        const imageBase64=await blobToBase64(c._blob);
        if(mode==='owner'){
          const d=await workerFetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poster:poster.id,imageBase64})});
          cm.textContent=`Publicado en slot ${d.slot}.`; cm.className='hypn-cardmsg ok'; file.value='';c._blob=null; await loadConfig();await fetchPending();renderOwner();
        }else{
          const d=await workerFetch('/api/collab/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poster:poster.id,imageBase64})});
          cm.textContent=`Solicitud #${d.submissionId||''} enviada.`; cm.className='hypn-cardmsg ok'; file.value='';c._blob=null; await fetchMine();renderCollab();
        }
      }catch(e){send.disabled=false;cm.textContent=e.message;cm.className='hypn-cardmsg err';}
    });
    return c;
  }

  function enhanceHead(container, role){
    const h2 = container.closest('.card')?.querySelector('h2');
    const help = container.closest('.card')?.querySelector('.help');
    if(role==='owner'){
      if(h2) h2.textContent='Galería de carteles del club';
      if(help) help.textContent='Cada área tiene sus propios carteles. Puedes ver la imagen activa y publicar directamente desde el cuadro correspondiente.';
    }else{
      if(h2) h2.textContent='Mis carteles autorizados';
    }
  }

  async function renderOwner(){
    const host=q('posterGroups'); if(!host||!cfg()) return;
    enhanceHead(host,'owner');
    if(!host.dataset.v14){ host.dataset.v14='1'; host.innerHTML='<div class="hypn-area-head"><div><p>Selecciona un área para ver sus carteles.</p></div><button class="ghost small hypn-refresh">RECARGAR</button></div><div class="hypn-tabs"></div><div class="hypn-gallery"></div>'; host.querySelector('.hypn-refresh').addEventListener('click',async()=>{await loadConfig();await fetchPending();renderOwner();}); }
    tabBar(host.querySelector('.hypn-tabs'),ownerTab,GROUP_ORDER,g=>{ownerTab=g;renderOwner();});
    const grid=host.querySelector('.hypn-gallery'); grid.innerHTML='';
    groupIds(ownerTab).forEach(id=>{const p=meta()[id];if(p)grid.appendChild(card(p,'owner',ownerStatus(id)));});
    const globalUpload=q('ownerPosterSelect')?.closest('.upload-card'); if(globalUpload) globalUpload.style.display='none';
    const footer=document.querySelector('footer'); if(footer) footer.textContent=`HYPN Remote Image System V${V} • 15 carteles • Aprobación OWNER • GitHub Pages + Cloudflare`;
    mountedOwner=true;
  }

  async function renderCollab(){
    const host=q('collabPosterGrid'); if(!host||!cfg()) return;
    enhanceHead(host,'collab');
    const allowed=allowedGroups(); if(!allowed.length){host.innerHTML='<div class="hypn-empty">Tu cuenta no tiene carteles asignados.</div>';return;}
    if(!allowed.includes(collabTab)) collabTab=allowed[0];
    if(!host.dataset.v14){ host.dataset.v14='1'; host.className=''; host.innerHTML='<div class="hypn-tabs"></div><div class="hypn-gallery"></div>'; }
    tabBar(host.querySelector('.hypn-tabs'),collabTab,allowed,g=>{collabTab=g;renderCollab();});
    const grid=host.querySelector('.hypn-gallery'); grid.innerHTML='';
    groupIds(collabTab).filter(id=>permissions().includes(id)).forEach(id=>{const p=meta()[id];if(p)grid.appendChild(card(p,'collab',collabStatus(id)));});
    const globalUpload=q('collabPosterSelect')?.closest('.upload-card'); if(globalUpload) globalUpload.style.display='none';
    mountedCollab=true;
  }

  async function mount(){
    const u=user(); if(!u||!cfg()) return;
    if(u.role==='owner'){ if(!mountedOwner) await fetchPending(); await renderOwner(); }
    if(u.role==='collab'){ if(!mountedCollab) await fetchMine(); await renderCollab(); }
  }

  const observer=new MutationObserver(()=>mount());
  const oa=q('ownerArea'), ca=q('collabArea'); if(oa)observer.observe(oa,{attributes:true,attributeFilter:['style']}); if(ca)observer.observe(ca,{attributes:true,attributeFilter:['style']});
  let tries=0; const timer=setInterval(async()=>{tries++;await mount();if((mountedOwner||mountedCollab)&&tries>4)clearInterval(timer);if(tries>30)clearInterval(timer);},500);
})();
