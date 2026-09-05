(() => {
  const style = document.createElement('style');
  style.textContent = `
    .hypn-user-admin{display:grid;gap:14px}
    .hypn-user-card{border:1px solid var(--line);background:#101017;border-radius:14px;padding:16px;display:grid;gap:14px}
    .hypn-user-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}
    .hypn-user-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .hypn-user-meta>div{background:#171720;border:1px solid var(--line);border-radius:10px;padding:10px}
    .hypn-user-meta span{display:block;color:var(--muted);font-size:11px;margin-bottom:4px}
    .hypn-user-meta strong{font-size:13px}
    .hypn-password-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:end}
    .hypn-permissions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .hypn-permissions label{display:flex;align-items:center;gap:8px;background:#171720;border:1px solid var(--line);border-radius:10px;padding:10px;font-weight:700}
    .hypn-permissions input{width:auto}
    .hypn-user-actions{display:flex;gap:8px;flex-wrap:wrap}
    .hypn-user-note{font-size:12px;color:var(--muted);line-height:1.45}
    @media(max-width:850px){.hypn-user-grid,.hypn-user-meta,.hypn-permissions,.hypn-password-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const formatUserDate = value => {
    const n = Number(value || 0);
    if (!n) return 'NUNCA';
    try { return new Date(n).toLocaleString(); } catch { return String(value); }
  };

  const hasAll = (permissions, ids) => ids.every(id => permissions.includes(id));
  const permissionsFromCard = card => {
    const out = [];
    if (card.querySelector('.perm-salon').checked) out.push(...GROUPS.salon_principal.ids);
    if (card.querySelector('.perm-colab').checked) out.push(...GROUPS.colaboradores.ids);
    if (card.querySelector('.perm-fuera').checked) out.push(...GROUPS.fuera_club.ids);
    return out;
  };

  loadUsers = async function () {
    if (me?.role !== 'owner') return;
    const holder = $('usersList');
    if (!holder) return;

    try {
      const data = await api('/api/owner/users');
      holder.innerHTML = '';
      holder.className = 'hypn-user-admin';

      if (!data.users?.length) {
        holder.innerHTML = '<div class="muted">Aún no hay colaboradores.</div>';
        return;
      }

      for (const user of data.users) {
        const card = document.createElement('div');
        card.className = 'hypn-user-card';
        card.dataset.id = user.id;
        const permissions = Array.isArray(user.permissions) ? user.permissions : [];

        card.innerHTML = `
          <div class="user-head">
            <div><strong>COLABORADOR #${user.id}</strong></div>
            <span class="pill ${user.active ? 'ok' : 'bad'}">${user.active ? 'ACTIVO' : 'DESACTIVADO'}</span>
          </div>

          <div class="hypn-user-grid">
            <label>Usuario
              <input class="edit-username" value="${esc(user.username)}" maxlength="64">
            </label>
            <label>Clave actual
              <input value="PROTEGIDA - NO RECUPERABLE" disabled>
            </label>
          </div>

          <div class="hypn-password-row">
            <label>Nueva contraseña
              <input class="new-password" type="password" placeholder="Escribe aquí solo si deseas cambiarla" maxlength="256">
            </label>
            <button class="ghost small show-password">MOSTRAR</button>
            <button class="ghost small save-password">CAMBIAR CLAVE</button>
          </div>

          <div class="hypn-user-note">La contraseña actual se guarda con hash de seguridad, por eso no puede recuperarse ni mostrarse. Puedes reemplazarla por una nueva cuando quieras.</div>

          <div class="hypn-user-meta">
            <div><span>ÚLTIMO ACCESO</span><strong>${esc(formatUserDate(user.last_login))}</strong></div>
            <div><span>CREADO</span><strong>${esc(formatUserDate(user.created_at))}</strong></div>
            <div><span>ÚLTIMO CAMBIO</span><strong>${esc(formatUserDate(user.updated_at))}</strong></div>
          </div>

          <div class="hypn-permissions">
            <label><input class="perm-salon" type="checkbox" ${hasAll(permissions, GROUPS.salon_principal.ids) ? 'checked' : ''}> Salón Principal</label>
            <label><input class="perm-colab" type="checkbox" ${hasAll(permissions, GROUPS.colaboradores.ids) ? 'checked' : ''}> Colaboradores</label>
            <label><input class="perm-fuera" type="checkbox" ${hasAll(permissions, GROUPS.fuera_club.ids) ? 'checked' : ''}> Fuera del Club</label>
          </div>

          <div class="hypn-user-actions">
            <button class="primary small save-user">GUARDAR USUARIO Y PERMISOS</button>
            <button class="${user.active ? 'danger' : 'ok'} small toggle-user">${user.active ? 'DESACTIVAR' : 'ACTIVAR'}</button>
            <button class="danger small delete-user">BORRAR USUARIO</button>
          </div>
        `;

        const usernameInput = card.querySelector('.edit-username');
        const passwordInput = card.querySelector('.new-password');
        const showBtn = card.querySelector('.show-password');

        showBtn.onclick = () => {
          const visible = passwordInput.type === 'text';
          passwordInput.type = visible ? 'password' : 'text';
          showBtn.textContent = visible ? 'MOSTRAR' : 'OCULTAR';
        };

        card.querySelector('.save-password').onclick = async () => {
          const password = passwordInput.value;
          if (!password) return msg('usersMsg', 'Escribe la nueva contraseña.', 'warn');
          try {
            await api('/api/owner/users/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, password })
            });
            passwordInput.value = '';
            msg('usersMsg', `Contraseña de ${usernameInput.value} actualizada.`, 'ok');
            await loadUsers();
          } catch (e) {
            msg('usersMsg', e.message, 'error');
          }
        };

        card.querySelector('.save-user').onclick = async () => {
          const username = usernameInput.value.trim();
          const permissions = permissionsFromCard(card);
          try {
            await api('/api/owner/users/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, username, permissions })
            });
            msg('usersMsg', `Usuario actualizado: ${username}.`, 'ok');
            await loadUsers();
          } catch (e) {
            msg('usersMsg', e.message, 'error');
          }
        };

        card.querySelector('.toggle-user').onclick = async () => {
          try {
            await api('/api/owner/users/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, active: !user.active })
            });
            await loadUsers();
          } catch (e) {
            msg('usersMsg', e.message, 'error');
          }
        };

        card.querySelector('.delete-user').onclick = async () => {
          const name = usernameInput.value.trim() || user.username;
          if (!confirm(`¿BORRAR definitivamente al usuario ${name}? También se eliminarán sus solicitudes guardadas.`)) return;
          try {
            await api('/api/owner/users/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id })
            });
            msg('usersMsg', `Usuario ${name} eliminado.`, 'ok');
            await loadUsers();
            await checkDb();
          } catch (e) {
            msg('usersMsg', e.message, 'error');
          }
        };

        holder.appendChild(card);
      }
    } catch (e) {
      holder.innerHTML = '';
      msg('usersMsg', e.message, 'error');
    }
  };

  const retry = () => {
    try {
      if (typeof me !== 'undefined' && me?.role === 'owner') loadUsers();
    } catch {}
  };
  setTimeout(retry, 800);
})();
