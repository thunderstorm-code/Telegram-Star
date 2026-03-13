const $ = (id) => document.getElementById(id);

const statusMap = {
  all: 'Все', clean: 'Чистые', spam: 'Спамблок', temp_spam: 'Временный спамблок',
  geo_spam: 'Гео-спамблок', frozen: 'Замороженные', unknown: 'Неизвестные'
};

const state = {
  accounts: [], page: 1, pageSize: 10, status: 'all', search: '', selected: null,
  tags: JSON.parse(localStorage.getItem('ts_tags') || '[]'),
  filters: { premium: 'any', has2fa: 'any', username: 'any', authorized: 'any', source: 'any', connection_state: 'any' },
  settings: null, presets: []
};

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2200);
}

function isEelAvailable() {
  return window.eel && typeof eel.list_accounts === 'function';
}

async function callEel(method, ...args) {
  if (!isEelAvailable() || typeof eel[method] !== 'function') {
    return { ok: false, error: 'Eel backend недоступен. Запустите python app.py' };
  }
  return eel[method](...args)();
}

function b64FromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function collectFiles(inputId) {
  const files = Array.from($(inputId).files || []);
  const result = [];
  for (const f of files) result.push({ name: f.webkitRelativePath || f.name, data: await b64FromFile(f) });
  return result;
}

function tabSwitch(targetTab) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelector(`.tab[data-panel="${targetTab}"]`)?.classList.add('active');
}

function bindTabs() {
  $('nav').querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dock-item').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      tabSwitch(btn.dataset.tab);
    });
  });
}

function bindSettingsTabs() {
  document.querySelectorAll('[data-set-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.set-tab').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.set-panel').forEach((x) => x.classList.remove('active'));
      document.querySelector(`.set-panel[data-set-panel="${btn.dataset.setTab}"]`)?.classList.add('active');
    });
  });
}

function renderHome() {
  const valid = state.accounts.filter((a) => a.connection_state === 'connected').length;
  const checking = state.accounts.filter((a) => a.connection_state === 'checking').length;
  const issues = state.accounts.filter((a) => ['error', 'invalid', 'limited'].includes(a.connection_state)).length;

  $('stats').innerHTML = `
    <article class="stat"><strong>${valid}</strong><small>Connected</small></article>
    <article class="stat"><strong>${checking}</strong><small>Checking</small></article>
    <article class="stat"><strong>${issues}</strong><small>Invalid / Limited</small></article>`;

  const features = [
    ['ri-upload-2-line', 'Авто-импорт', 'Выбрали файл — импорт и проверка запускаются автоматически.'],
    ['ri-shield-check-line', 'Авто-проверка', 'После добавления идет мгновенная проверка сессии/API.'],
    ['ri-flashlight-line', 'Минимум кликов', 'Критичные действия на первом уровне, вторичные в модалках.'],
    ['ri-dashboard-line', 'Компактный SaaS UI', 'Сжатые отступы, быстрые анимации, clean layout.']
  ];

  $('homeFeatures').innerHTML = features.map(([icon, title, text]) => `<article class="feature"><i class="${icon}"></i><div><strong>${title}</strong><div>${text}</div></div></article>`).join('');
  $('toolsList').innerHTML = [
    ['ri-inbox-archive-line', 'Импорт/разбор аккаунтов'],
    ['ri-cpu-line', 'Мониторинг статусов'],
    ['ri-database-2-line', 'Экспорт сессий']
  ].map(([icon, title]) => `<article class="tool-item feature"><i class="${icon}"></i><strong>${title}</strong></article>`).join('');
}

function passFilter(value, mode) {
  if (mode === 'any') return true;
  if (mode === 'yes') return Boolean(value);
  if (mode === 'no') return !value;
  return String(value) === String(mode);
}

function filteredAccounts() {
  return state.accounts.filter((a) => {
    if (state.status !== 'all' && a.status !== state.status) return false;
    if (!passFilter(a.premium, state.filters.premium)) return false;
    if (!passFilter(a.has2fa, state.filters.has2fa)) return false;
    if (!passFilter(Boolean(a.username), state.filters.username)) return false;
    if (!passFilter(a.authorized, state.filters.authorized)) return false;
    if (state.filters.source !== 'any' && a.source !== state.filters.source) return false;
    if (state.filters.connection_state !== 'any' && a.connection_state !== state.filters.connection_state) return false;

    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.phone || '', a.username || '', a.source || '', a.limits || '', a.proxy || ''].join(' ').toLowerCase().includes(q);
  });
}

function renderStatusPills() {
  $('statusPills').innerHTML = Object.entries(statusMap).map(([k, v]) => `<button class="pill-s ${state.status === k ? 'active' : ''}" data-status="${k}">${v}</button>`).join('');
  $('statusPills').querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    state.page = 1;
    renderStatusPills();
    renderAccounts();
  }));
}

function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;
  $('pagination').innerHTML = Array.from({ length: pages }).map((_, i) => {
    const p = i + 1;
    return `<button class="pg ${state.page === p ? 'active' : ''}" data-p="${p}">${p}</button>`;
  }).join('');
  $('pagination').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    state.page = Number(b.dataset.p);
    renderAccounts();
  }));
}

function renderAccounts() {
  const list = filteredAccounts();
  const start = (state.page - 1) * state.pageSize;
  const items = list.slice(start, start + state.pageSize);

  $('accountsList').innerHTML = items.map((a) => `
    <article class="acc-item">
      <div class="acc-left">
        <div class="acc-title">${a.name}</div>
        <div class="acc-sub">${a.username ? '@' + a.username : 'id: ' + a.name} · ${a.source || 'session'} · proxy: ${a.proxy || '—'} · limits: ${a.limits || '—'}</div>
      </div>
      <div>
        <span class="status-tag status-${a.status || 'unknown'}">${statusMap[a.status] || 'Неизвестные'}</span>
        <span class="conn-badge cs-${a.connection_state || 'unknown'}">${a.connection_state || 'unknown'}</span>
      </div>
      <button class="btn ghost" data-open="${a.name}">Открыть</button>
    </article>
  `).join('');

  $('accountsList').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => openAccount(b.dataset.open)));
  renderPagination(list.length);
}

async function refreshAccounts() {
  const data = await callEel('list_accounts');
  if (Array.isArray(data)) {
    state.accounts = data.map((a) => ({ ...a, id: a.name }));
  }
  renderHome();
  renderStatusPills();
  renderAccounts();
}

function selectedOrFirstName() {
  return state.selected || state.accounts[0]?.name || '';
}

async function runAutoImportSession() {
  const files = await collectFiles('sessionInput');
  if (!files.length) return;
  const res = await callEel('import_session_files', $('importPrefix').value.trim(), files);
  toast(res.ok ? `Импорт: ${res.count}. Автопроверка выполнена.` : res.error);
  if (res.ok) await refreshAccounts();
}

async function runAutoImportTdata() {
  const files = await collectFiles('tdataInput');
  if (!files.length) return;
  const res = await callEel('import_tdata_files', $('tdataName').value.trim(), files);
  toast(res.ok ? `${res.message}` : res.error);
  if (res.ok) await refreshAccounts();
}

function bindAutomation() {
  $('quickImportBtn').addEventListener('click', () => $('importModal').classList.remove('hidden'));
  $('quickFilterBtn').addEventListener('click', () => $('filterModal').classList.remove('hidden'));

  $('sessionInput').addEventListener('change', runAutoImportSession);
  $('tdataInput').addEventListener('change', runAutoImportTdata);

  $('requestCodeBtn').addEventListener('click', async () => {
    const res = await callEel('request_code', selectedOrFirstName());
    toast(res.ok ? 'Код отправлен' : res.error);
  });

  $('signInBtn').addEventListener('click', async () => {
    const res = await callEel('sign_in', selectedOrFirstName(), $('accCode').value.trim(), $('accPassword').value.trim());
    toast(res.ok ? 'Авторизация и проверка завершены' : res.error);
    await refreshAccounts();
  });

  $('sendMessageBtn').addEventListener('click', async () => {
    const res = await callEel('send_message', selectedOrFirstName(), $('msgTarget').value.trim(), $('msgText').value.trim());
    toast(res.ok ? 'Сообщение отправлено' : res.error);
  });

  $('loadDialogsBtn').addEventListener('click', async () => {
    const res = await callEel('fetch_dialogs', selectedOrFirstName(), 30);
    toast(res.ok ? `Диалогов: ${res.dialogs.length}` : res.error);
  });
}

async function openAccount(name) {
  state.selected = name;
  const res = await callEel('get_account_profile', name);
  if (!res.ok) return toast(res.error);

  const p = res.profile;
  const identity = p.username ? `@${p.username}` : String(p.id || 'id отсутствует');
  $('modalAvatar').textContent = (p.name || name)[0]?.toUpperCase() || 'A';
  $('modalName').textContent = p.name || name;
  $('modalIdentity').textContent = identity;
  $('modalIdentity').onclick = async () => {
    try { await navigator.clipboard.writeText(identity); } catch (_) {}
    toast('Скопировано: ' + identity);
  };

  const row = state.accounts.find((a) => a.name === name) || {};
  $('modalInfo').innerHTML = `
    <div class="meta-item"><small>Статус</small><div>${row.connection_state || 'unknown'}</div></div>
    <div class="meta-item"><small>Лимиты</small><div>${row.limits || '—'}</div></div>
    <div class="meta-item"><small>Телефон</small><div>${p.phone || '—'}</div></div>
    <div class="meta-item"><small>Premium</small><div>${p.premium ? 'Да' : 'Нет'}</div></div>
  `;

  $('recheckBtn').onclick = async () => {
    const r = await callEel('check_account', name);
    toast(r.ok ? 'Проверка завершена' : r.error || 'Проверка с ошибкой');
    await refreshAccounts();
    await openAccount(name);
  };

  $('removeBtn').onclick = async () => {
    const r = await callEel('remove_account', name);
    toast(r.ok ? 'Аккаунт удалён' : r.error);
    if (r.ok) {
      $('accountModal').classList.add('hidden');
      await refreshAccounts();
    }
  };

  $('downloadBtn').onclick = () => $('downloadMenu').classList.toggle('hidden');
  $('downloadMenu').querySelectorAll('[data-format]').forEach((b) => {
    b.onclick = async () => {
      const r = await callEel('export_account', name, b.dataset.format);
      toast(r.ok ? `${r.message}` : r.error);
      $('downloadMenu').classList.add('hidden');
    };
  });

  $('accountModal').classList.remove('hidden');
}

function bindFilters() {
  $('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.page = 1;
    renderAccounts();
  });
  $('openFilterModal').addEventListener('click', () => $('filterModal').classList.remove('hidden'));

  document.querySelectorAll('[data-f]').forEach((b) => {
    b.addEventListener('click', () => {
      const [k, v] = b.dataset.f.split(':');
      state.filters[k] = v;
      b.parentElement.querySelectorAll('.opt').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  $('applyFiltersBtn').addEventListener('click', () => {
    $('filterModal').classList.add('hidden');
    state.page = 1;
    renderAccounts();
  });
}

async function bindSettings() {
  const st = await callEel('get_settings');
  if (st.ok) {
    state.settings = st.settings;
    document.body.dataset.theme = st.settings.theme || 'gray';
    $('apiId').value = st.settings.api_id || '';
    $('apiHash').value = st.settings.api_hash || '';
  }

  const p = await callEel('list_device_presets');
  if (p.ok) {
    state.presets = p.presets;
    $('devicePresetSelect').innerHTML = p.presets.map((x) => `<option value="${x.id}">${x.title} (${x.category})</option>`).join('');
    if (state.settings?.device_preset) $('devicePresetSelect').value = state.settings.device_preset;
    renderPresetInfo();
  }

  document.querySelectorAll('.theme-pills .pill').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === document.body.dataset.theme);
    b.addEventListener('click', async () => {
      const theme = b.dataset.theme;
      document.body.dataset.theme = theme;
      document.querySelectorAll('.theme-pills .pill').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      await callEel('update_settings', { theme });
    });
  });

  $('saveApiBtn').addEventListener('click', async () => {
    const res = await callEel('update_settings', { api_id: $('apiId').value.trim(), api_hash: $('apiHash').value.trim() });
    toast(res.ok ? 'API сохранен' : res.error);
  });

  $('devicePresetSelect').addEventListener('change', renderPresetInfo);
  $('saveDevicePresetBtn').addEventListener('click', async () => {
    const res = await callEel('update_settings', { device_preset: $('devicePresetSelect').value });
    toast(res.ok ? 'Шаблон сохранен' : res.error);
  });

  $('addTagBtn').addEventListener('click', () => {
    const name = $('tagName').value.trim();
    const color = $('tagColor').value;
    if (!name) return;
    state.tags.push({ name, color });
    localStorage.setItem('ts_tags', JSON.stringify(state.tags));
    $('tagName').value = '';
    renderTags();
  });

  renderTags();
}

function renderPresetInfo() {
  const preset = state.presets.find((x) => x.id === $('devicePresetSelect').value) || state.presets[0];
  if (!preset) return;
  $('devicePresetInfo').innerHTML = `<div><strong>${preset.title}</strong> (${preset.category})</div><div>app_id: ${preset.app_id}</div><div>device: ${preset.device_model}</div><div>system: ${preset.system_version}</div><div>app: ${preset.app_version}</div><div>lang: ${preset.lang_code}/${preset.system_lang_code}</div>`;
}

function renderTags() {
  $('tagList').innerHTML = state.tags.map((t, i) => `<button class="tag-chip" data-tag-rm="${i}" style="background:${t.color}22;color:${t.color};border-color:${t.color};">${t.name} ✕</button>`).join('');
  $('tagList').querySelectorAll('[data-tag-rm]').forEach((b) => b.addEventListener('click', () => {
    state.tags.splice(Number(b.dataset.tagRm), 1);
    localStorage.setItem('ts_tags', JSON.stringify(state.tags));
    renderTags();
  }));
}

function bindModalClose() {
  $('closeAccountModal').addEventListener('click', () => $('accountModal').classList.add('hidden'));
  ['filterModal', 'accountModal', 'importModal'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target.id === id) $(id).classList.add('hidden');
    });
  });
}

async function init() {
  bindTabs();
  bindSettingsTabs();
  bindAutomation();
  bindFilters();
  await bindSettings();
  bindModalClose();
  await refreshAccounts();

  // lightweight auto-refresh for account states
  setInterval(refreshAccounts, 8000);
}

init();
