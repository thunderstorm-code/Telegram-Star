const $ = (id) => document.getElementById(id);

const statusMap = {
  all: 'Все',
  clean: 'Чистые',
  spam: 'Спамблок',
  temp_spam: 'Временный спамблок',
  geo_spam: 'Гео-спамблок',
  frozen: 'Замороженные',
  unknown: 'Неизвестные'
};

const state = {
  accounts: [],
  page: 1,
  pageSize: 8,
  status: 'all',
  search: '',
  selected: null,
  tags: JSON.parse(localStorage.getItem('ts_tags') || '[]'),
  filters: { premium: 'any', has2fa: 'any', username: 'any', authorized: 'any', source: 'any', phone: 'any' },
  settings: null,
  presets: []
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
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function collectFiles(inputId) {
  const input = $(inputId);
  const files = Array.from(input.files || []);
  const result = [];
  for (const f of files) {
    result.push({ name: f.webkitRelativePath || f.name, data: await b64FromFile(f) });
  }
  return result;
}

function bindTabs() {
  $('nav').querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dock-item').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelector(`.tab[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
  });
}

function bindSettingsTabs() {
  document.querySelectorAll('[data-set-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.set-tab').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.set-panel').forEach((x) => x.classList.remove('active'));
      document.querySelector(`.set-panel[data-set-panel="${btn.dataset.setTab}"]`).classList.add('active');
    });
  });
}

function renderHome() {
  const valid = state.accounts.filter((a) => a.authorized).length;
  const spam = state.accounts.filter((a) => ['spam', 'temp_spam', 'geo_spam'].includes(a.status)).length;
  const invalid = state.accounts.length - valid;

  $('stats').innerHTML = `
    <article class="stat"><strong>${valid}</strong><small>Валидные</small></article>
    <article class="stat"><strong>${spam}</strong><small>Со спамблоком</small></article>
    <article class="stat"><strong>${invalid}</strong><small>Невалидные</small></article>`;

  const features = [
    ['ri-folder-upload-line', 'Импорт .session/tdata', 'Добавление аккаунтов только файлами, как вы и просили.'],
    ['ri-key-2-line', 'Авторизация', 'Запрос кода и вход с 2FA для Telethon.'],
    ['ri-chat-1-line', 'Сообщения', 'Отправка сообщений от выбранного аккаунта.'],
    ['ri-message-3-line', 'Диалоги', 'Просмотр последних диалогов аккаунта.'],
    ['ri-download-2-line', 'Экспорт', 'Выгрузка telethon / pyrogram / tdata.'],
    ['ri-smartphone-line', 'Шаблоны устройств', '10 пресетов device_model/system/version.']
  ];

  $('homeFeatures').innerHTML = features.map(([icon, title, text]) => `
    <article class="feature"><i class="${icon}"></i><div><strong>${title}</strong><div>${text}</div></div></article>
  `).join('');

  $('toolsList').innerHTML = [
    ['ri-inbox-archive-line', 'Импорт/разбор аккаунтов'],
    ['ri-shapes-line', 'Конвертер форматов'],
    ['ri-shield-check-line', 'Проверка статусов']
  ].map(([icon, title]) => `<article class="tool-item feature"><i class="${icon}"></i><strong>${title}</strong></article>`).join('');
}

function passTriFilter(value, mode) {
  if (mode === 'any') return true;
  if (mode === 'yes') return Boolean(value);
  if (mode === 'no') return !value;
  return String(value) === String(mode);
}

function filteredAccounts() {
  return state.accounts.filter((a) => {
    if (state.status !== 'all' && a.status !== state.status) return false;
    if (!passTriFilter(a.premium, state.filters.premium)) return false;
    if (!passTriFilter(a.has2fa, state.filters.has2fa)) return false;
    if (!passTriFilter(Boolean(a.username), state.filters.username)) return false;
    if (!passTriFilter(a.authorized, state.filters.authorized)) return false;
    if (state.filters.source !== 'any' && a.source !== state.filters.source) return false;
    if (!passTriFilter(Boolean(a.phone), state.filters.phone)) return false;

    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.phone || '', a.username || '', String(a.id || ''), a.source || ''].join(' ').toLowerCase().includes(q);
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
        <div class="acc-sub">${a.phone || 'без телефона'} · ${a.username ? '@' + a.username : 'без username'} · ${a.source || 'session'}</div>
      </div>
      <span class="status-tag status-${a.status || 'unknown'}">${statusMap[a.status] || 'Неизвестные'}</span>
      <button class="btn ghost" data-open="${a.name}">Открыть</button>
    </article>
  `).join('');

  $('accountsList').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => openAccount(b.dataset.open)));
  renderPagination(list.length);
}

async function refreshAccounts() {
  const data = await callEel('list_accounts');
  if (Array.isArray(data)) {
    state.accounts = data.map((a) => ({
      ...a,
      id: a.name
    }));
  }
  renderHome();
  renderStatusPills();
  renderAccounts();
}

function selectedOrFirstAccountName() {
  return state.selected || state.accounts[0]?.name || '';
}

function bindImportAndActions() {
  $('importSessionBtn').addEventListener('click', async () => {
    const files = await collectFiles('sessionInput');
    const res = await callEel('import_session_files', $('importPrefix').value.trim(), files);
    toast(res.ok ? `Импортировано: ${res.count}` : res.error);
    if (res.ok) refreshAccounts();
  });

  $('importTdataBtn').addEventListener('click', async () => {
    const files = await collectFiles('tdataInput');
    const res = await callEel('import_tdata_files', $('tdataName').value.trim(), files);
    toast(res.ok ? res.message : res.error);
    if (res.ok) refreshAccounts();
  });

  $('requestCodeBtn').addEventListener('click', async () => {
    const name = selectedOrFirstAccountName();
    const res = await callEel('request_code', name);
    toast(res.ok ? 'Код отправлен' : res.error);
  });

  $('signInBtn').addEventListener('click', async () => {
    const name = selectedOrFirstAccountName();
    const res = await callEel('sign_in', name, $('accCode').value.trim(), $('accPassword').value.trim());
    toast(res.ok ? 'Авторизация выполнена' : res.error);
    if (res.ok) refreshAccounts();
  });

  $('sendMessageBtn').addEventListener('click', async () => {
    const name = selectedOrFirstAccountName();
    const res = await callEel('send_message', name, $('msgTarget').value.trim(), $('msgText').value.trim());
    toast(res.ok ? 'Сообщение отправлено' : res.error);
  });

  $('loadDialogsBtn').addEventListener('click', async () => {
    const name = selectedOrFirstAccountName();
    const res = await callEel('fetch_dialogs', name, 30);
    toast(res.ok ? `Диалогов: ${res.dialogs.length}` : res.error);
  });
}

async function openAccount(name) {
  state.selected = name;
  const res = await callEel('get_account_profile', name);
  if (!res.ok) return toast(res.error);

  const p = res.profile;
  $('modalAvatar').textContent = (p.name || name)[0]?.toUpperCase() || 'A';
  $('modalName').textContent = p.name || name;
  const identity = p.username ? `@${p.username}` : String(p.id || 'id отсутствует');
  $('modalIdentity').textContent = identity;
  $('modalIdentity').onclick = async () => {
    try { await navigator.clipboard.writeText(identity); } catch (_) {}
    toast('Скопировано: ' + identity);
  };

  $('modalInfo').innerHTML = `
    <div class="meta-item"><small>Телефон</small><div>${p.phone || '—'}</div></div>
    <div class="meta-item"><small>ID</small><div>${p.id || '—'}</div></div>
    <div class="meta-item"><small>Premium</small><div>${p.premium ? 'Да' : 'Нет'}</div></div>
    <div class="meta-item"><small>Диалоги</small><div>${p.dialogs}</div></div>
    <div class="meta-item"><small>Статус</small><div>${statusMap[p.status] || 'Неизвестные'}</div></div>
  `;

  $('removeBtn').onclick = async () => {
    const r = await callEel('remove_account', name);
    toast(r.ok ? 'Аккаунт удалён' : r.error);
    if (r.ok) {
      $('accountModal').classList.add('hidden');
      refreshAccounts();
    }
  };

  $('downloadBtn').onclick = () => $('downloadMenu').classList.toggle('hidden');
  $('downloadMenu').querySelectorAll('[data-format]').forEach((b) => {
    b.onclick = async () => {
      const r = await callEel('export_account', name, b.dataset.format);
      toast(r.ok ? `${r.message} | ${r.path}` : r.error);
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
    document.querySelectorAll('.theme-pills .pill').forEach((x) => x.classList.remove('active'));
    const active = document.querySelector(`.theme-pills .pill[data-theme="${document.body.dataset.theme}"]`);
    if (active) active.classList.add('active');
  }

  const p = await callEel('list_device_presets');
  if (p.ok) {
    state.presets = p.presets;
    $('devicePresetSelect').innerHTML = p.presets.map((x) => `<option value="${x.id}">${x.title} (${x.category})</option>`).join('');
    if (state.settings?.device_preset) $('devicePresetSelect').value = state.settings.device_preset;
    renderPresetInfo();
  }

  document.querySelectorAll('.theme-pills .pill').forEach((b) => {
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
    toast(res.ok ? 'API сохранён' : res.error);
  });

  $('devicePresetSelect').addEventListener('change', renderPresetInfo);
  $('saveDevicePresetBtn').addEventListener('click', async () => {
    const res = await callEel('update_settings', { device_preset: $('devicePresetSelect').value });
    toast(res.ok ? 'Шаблон устройства сохранен' : res.error);
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
  $('devicePresetInfo').innerHTML = `
    <div><strong>${preset.title}</strong> (${preset.category})</div>
    <div>app_id: ${preset.app_id}</div>
    <div>device_model: ${preset.device_model}</div>
    <div>system_version: ${preset.system_version}</div>
    <div>app_version: ${preset.app_version}</div>
    <div>lang: ${preset.lang_code} / ${preset.system_lang_code}</div>
  `;
}

function renderTags() {
  $('tagList').innerHTML = state.tags.map((t, i) => `<button class="tag-chip" data-tag-rm="${i}" style="background:${t.color}22;color:${t.color};border-color:${t.color};">${t.name} ✕</button>`).join('');
  $('tagList').querySelectorAll('[data-tag-rm]').forEach((b) => {
    b.addEventListener('click', () => {
      state.tags.splice(Number(b.dataset.tagRm), 1);
      localStorage.setItem('ts_tags', JSON.stringify(state.tags));
      renderTags();
    });
  });
}

function bindModalClose() {
  $('closeAccountModal').addEventListener('click', () => $('accountModal').classList.add('hidden'));

  ['filterModal', 'accountModal'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target.id === id) $(id).classList.add('hidden');
    });
  });
}

async function init() {
  bindTabs();
  bindSettingsTabs();
  bindImportAndActions();
  bindFilters();
  await bindSettings();
  bindModalClose();
  await refreshAccounts();
}

init();
