(() => {
  const VERSION = '1.4.11';

  const style = document.createElement('style');
  style.textContent = `
    .hypn-role-create-note{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.45}
    .hypn-role-editor{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}
    .hypn-role-editor .role-preview{min-width:120px;text-align:center;justify-content:center}
    .hypn-role-pill{margin-left:auto;margin-right:8px}
    @media(max-width:850px){.hypn-role-editor{grid-template-columns:1fr}.hypn-role-pill{margin-left:0;margin-right:0}}
  `;
  document.head.appendChild(style);

  function cleanRole(value) {
    const role = String(value ?? '').trim().replace(/\s+/g, ' ');
    return role || 'COLABORADOR';
  }

  function permissionsFromRoleCard(card) {
    const out = [];
    if (card.querySelector('.perm-salon')?.checked) out.push(...GROUPS.salon_principal.ids);
    if (card.querySelector('.perm-colab')?.checked) out.push(...GROUPS.colaboradores.ids);
    if (card.querySelector('.perm-fuera')?.checked) out.push(...GROUPS.fuera_club.ids);
    return out;
  }

  function installCreateRoleField() {
    const username = $('newUsername');
    if (!username || $('newCustomRole')) return;
    const grid = username.closest('.grid');
    if (!grid) return;

    const label = document.createElement('label');
    label.innerHTML = `Rol personalizado
      <input id="newCustomRole" maxlength="48" placeholder="ej. DJ RESIDENTE, FOTÓGRAFO, STAFF VIP">
      <div class="hypn-role-create-note">Escribe el rol que quieras. Si lo dejas vacío será COLABORADOR.</div>`;
    grid.appendChild(label);
  }

  function installCreateHandler() {
    const button = $('createUserBtn');
    if (!button) return;

    button.onclick = async () => {
      button.disabled = true;
      try {
        const username = $('newUsername').value.trim();
        const password = $('newPassword').value;
        const custom_role = cleanRole($('newCustomRole')?.value);
        const permissions = selectedPerms();

        await api('/api/owner/users/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, custom_role, permissions })
        });

        $('newUsername').value = '';
        $('newPassword').value = '';
        if ($('newCustomRole')) $('newCustomRole').value = '';
        msg('userCreateMsg', `Usuario creado con rol: ${custom_role}.`, 'ok');
        await loadUsers();
        await checkDb();
      } catch (e) {
        msg('userCreateMsg', e.message, 'error');
      } finally {
        button.disabled = false;
      }
    };
  }

  async function decorateUserCards() {
    if (typeof me === 'undefined' || me?.role !== 'owner') return;
    const holder = $('usersList');
    if (!holder) return;

    let data;
    try {
      data = await api('/api/owner/users');
    } catch (e) {
      msg('usersMsg', e.message, 'error');
      return;
    }

    const byId = new Map((data.users || []).map(user => [String(user.id), user]));

    holder.querySelectorAll('.hypn-user-card').forEach(card => {
      const user = byId.get(String(card.dataset.id));
      if (!user) return;
      const role = cleanRole(user.custom_role);

      let editor = card.querySelector('.hypn-role-editor');
      if (!editor) {
        editor = document.createElement('div');
        editor.className = 'hypn-role-editor';
        editor.innerHTML = `
          <label>Rol personalizado
            <input class="edit-custom-role" maxlength="48" placeholder="Escribe cualquier rol">
          </label>
          <span class="pill ok role-preview"></span>`;
        const meta = card.querySelector('.hypn-user-meta');
        card.insertBefore(editor, meta || card.querySelector('.hypn-permissions'));
      }

      const roleInput = editor.querySelector('.edit-custom-role');
      const preview = editor.querySelector('.role-preview');
      roleInput.value = role;
      preview.textContent = role;
      roleInput.oninput = () => { preview.textContent = cleanRole(roleInput.value); };

      const head = card.querySelector('.user-head');
      let rolePill = head?.querySelector('.hypn-role-pill');
      if (!rolePill && head) {
        rolePill = document.createElement('span');
        rolePill.className = 'pill ok hypn-role-pill';
        const activePill = head.querySelector('.pill');
        head.insertBefore(rolePill, activePill || null);
      }
      if (rolePill) rolePill.textContent = role;

      const save = card.querySelector('.save-user');
      if (save) {
        save.textContent = 'GUARDAR USUARIO, ROL Y PERMISOS';
        save.onclick = async () => {
          const username = card.querySelector('.edit-username')?.value.trim() || user.username;
          const custom_role = cleanRole(roleInput.value);
          const permissions = permissionsFromRoleCard(card);
          save.disabled = true;
          try {
            await api('/api/owner/users/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, username, custom_role, permissions })
            });
            msg('usersMsg', `${username} actualizado con rol ${custom_role}.`, 'ok');
            await loadUsers();
          } catch (e) {
            msg('usersMsg', e.message, 'error');
          } finally {
            save.disabled = false;
          }
        };
      }
    });
  }

  function updateVisibleRole() {
    try {
      if (typeof me === 'undefined' || !me || !$('roleStat')) return;
      const visibleRole = me.role === 'owner' ? 'OWNER' : cleanRole(me.custom_role || me.display_role);
      $('roleStat').textContent = visibleRole.toUpperCase();
    } catch {}
  }

  installCreateRoleField();
  installCreateHandler();

  if (typeof loadUsers === 'function') {
    const previousLoadUsers = loadUsers;
    loadUsers = async function () {
      await previousLoadUsers();
      await decorateUserCards();
    };
  }

  setInterval(updateVisibleRole, 500);
  setTimeout(async () => {
    installCreateRoleField();
    installCreateHandler();
    updateVisibleRole();
    try {
      if (typeof me !== 'undefined' && me?.role === 'owner') await loadUsers();
    } catch {}
  }, 900);

  const footer = document.querySelector('footer');
  if (footer) footer.textContent = `HYPN Imaging System V${VERSION} • roles personalizados • ADMIN publica directo`;
})();

(() => {
  if (document.querySelector('script[data-hypn-admin-vrchat]')) return;
  const script = document.createElement('script');
  script.src = 'admin-vrchat-v1418.js?v=1418';
  script.dataset.hypnAdminVrchat = '1';
  document.body.appendChild(script);
})();
