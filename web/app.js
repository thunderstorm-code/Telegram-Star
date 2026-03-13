const $ = (id) => document.getElementById(id);

const state = {
  activeTab: 'home',
  search: '',
  filters: { valid: false, premium: false, has2fa: false, hasUsername: false },
  status: 'all',
  page: 1,
  pageSize: 6,
  selectedAccount: null,
  customTags: JSON.parse(localStorage.getItem('ts_custom_tags') || '[]'),
  accounts: []
};

const statusTabs = [
  ['all', 'Все'], ['clean', 'Чистые'], ['spam', 'Спамблок'], ['temp_spam', 'Временный спамблок'],
  ['geo_spam', 'Гео-спамблок'], ['frozen', 'Замороженные'], ['unknown', 'Неизвестные']
];

const moduleCards = [
  { icon: '<i class=\"ri-inbox-archive-line\"></i>', name: 'Загрузка аккаунтов', status: 'Готово', description: 'Импорт сессий и JSON/ZIP пакетов.' },
  { icon: '<i class=\"ri-profile-line\"></i>', name: 'Список аккаунтов', status: 'Готово', description: 'Поиск, фильтрация, статусы и групповые действия.' },
  { icon: '<i class=\"ri-refresh-line\"></i>', name: 'Конвертирование', status: 'Beta', description: 'Конвертер tdata ⇄ telethon ⇄ pyrogram.' },
  { icon: '<i class=\"ri-eraser-line\"></i>', name: 'Чистка', status: 'Готово', description: 'Удаление невалидных, чистка сессий и дублей.' },
  { icon: '<i class=\"ri-tools-line\"></i>', name: 'Доп. инструменты', status: 'Preview', description: 'Проверка лимитов, профилей и API-статуса.' }
];

const tools = [
  { title: '<i class=\"ri-folder-upload-line\"></i> Импорт и разбор аккаунтов', list: ['tdata', 'telethon .session', 'json exports'] },
  { title: '<i class=\"ri-shapes-line\"></i> Конвертер форматов', list: ['tdata → telethon', 'telethon → pyrogram', 'bulk convert'] },
  { title: '<i class=\"ri-shield-check-line\"></i> Проверка статусов', list: ['валидность', 'спамблок', 'premium/2FA/username'] }
];

const numbersStats = [
  { title: 'Активные', value: '17' },
  { title: 'В очереди', value: '5' },
  { title: 'Успешные', value: '143' }
];

function sampleAccounts() {
  const statuses = ['clean', 'spam', 'temp_spam', 'geo_spam', 'frozen', 'unknown'];
  return Array.from({ length: 24 }).map((_, i) => {
    const id = 100000 + i;
    const status = statuses[i % statuses.length];
    return {
      id,
      name: `Account ${i + 1}`,
      username: i % 3 ? `user_${i + 1}` : '',
      valid: status !== 'frozen' && status !== 'unknown',
      status,
      premium: i % 4 === 0,
      has2fa: i % 5 !== 0,
      phone: `+7999000${String(i).padStart(3, '0')}`,
      country: { code: 'RU', flag: '🇷🇺', full: 'Russia' },
      apiStatus: i % 2 ? 'ok' : 'limited',
      sessions: 1 + (i % 3),
      dialogs: 20 + i,
      lastActive: `${1 + (i % 9)} ч назад`,
      comment: 'Демо-аккаунт панели Telegram Star.',
      tags: []
    };
  });
}

async function loadAccounts() {
  state.accounts = sampleAccounts();

  if (window.eel && typeof eel.list_accounts === 'function') {
    try {
      const backend = await eel.list_accounts()();
      if (Array.isArray(backend) && backend.length) {
        state.accounts = backend.map((item, index) => ({
          ...state.accounts[index % state.accounts.length],
          name: item.name || `Account ${index + 1}`,
          phone: item.phone || '—',
          valid: Boolean(item.authorized),
          status: item.authorized ? 'clean' : 'unknown'
        }));
      }
    } catch (_) {
      // fallback on demo data
    }
  }
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 1800);
}

function renderStats() {
  const valid = state.accounts.filter((a) => a.valid).length;
  const spam = state.accounts.filter((a) => ['spam', 'temp_spam', 'geo_spam'].includes(a.status)).length;
  const invalid = state.accounts.length - valid;
  $('statsGrid').innerHTML = [
    ['Валидные аккаунты', valid],
    ['Со спамблоком', spam],
    ['Невалидные', invalid]
  ].map(([title, val]) => `<div class="stat-card fade-up"><h4>${title}</h4><strong>${val}</strong></div>`).join('');
}

function renderModules() {
  $('moduleGrid').innerHTML = moduleCards.map((m) => `
    <article class="module-card fade-up">
      <h4>${m.icon} ${m.name}</h4>
      <p class="module-status">Статус: ${m.status}</p>
      <p>${m.description}</p>
    </article>
  `).join('');
}

function renderTools() {
  $('toolGrid').innerHTML = tools.map((tool) => `
    <article class="tool-card fade-up">
      <h4>${tool.title}</h4>
      <ul class="clean-list">${tool.list.map((i) => `<li>${i}</li>`).join('')}</ul>
      <button class="primary-btn">Открыть модуль</button>
    </article>
  `).join('');
}

function renderNumbersStats() {
  $('numbersStats').innerHTML = numbersStats.map((s) => `
    <div class="stat-card fade-up"><h4>${s.title}</h4><strong>${s.value}</strong></div>
  `).join('');
}

function renderStateTabs() {
  $('stateTabs').innerHTML = statusTabs.map(([key, title]) => `
    <button class="state-btn ${state.status === key ? 'active' : ''}" data-status="${key}">${title}</button>
  `).join('');

  $('stateTabs').querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.status = btn.dataset.status;
      state.page = 1;
      renderStateTabs();
      renderAccounts();
    });
  });
}

function filteredAccounts() {
  return state.accounts.filter((a) => {
    if (state.status !== 'all' && a.status !== state.status) return false;
    if (state.filters.valid && !a.valid) return false;
    if (state.filters.premium && !a.premium) return false;
    if (state.filters.has2fa && !a.has2fa) return false;
    if (state.filters.hasUsername && !a.username) return false;

    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.username, String(a.id), a.phone].join(' ').toLowerCase().includes(q);
  });
}

function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;

  $('pagination').innerHTML = Array.from({ length: pages }).map((_, i) => {
    const p = i + 1;
    return `<button class="page-btn ${state.page === p ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }).join('');

  $('pagination').querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.page = Number(btn.dataset.page);
      renderAccounts();
    });
  });
}

function renderAccounts() {
  const list = filteredAccounts();
  const start = (state.page - 1) * state.pageSize;
  const pageItems = list.slice(start, start + state.pageSize);

  $('accountsGrid').innerHTML = pageItems.map((a) => `
    <article class="account-card fade-up" data-open-account="${a.id}">
      <div class="account-top">
        <div class="avatar">${a.name[0]}</div>
        <div><span class="valid-dot ${a.valid ? 'good' : 'bad'}"></span>${a.valid ? 'Valid' : 'Invalid'}</div>
      </div>
      <h4>${a.name}</h4>
      <div class="account-id">${a.username ? '@' + a.username : 'ID: ' + a.id}</div>
      <p>Статус: ${statusTabs.find((s) => s[0] === a.status)?.[1] || 'Неизвестно'}</p>
    </article>
  `).join('');

  renderPagination(list.length);

  $('accountsGrid').querySelectorAll('[data-open-account]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.openAccount);
      openAccountModal(state.accounts.find((a) => a.id === id));
    });
  });
}

function openAccountModal(account) {
  state.selectedAccount = account;
  $('accountModalTitle').textContent = account.name;

  const tags = account.tags.map((t) => `<span class="tag-chip" style="background:${t.color}22;color:${t.color};">${t.name}</span>`).join('') || 'Нет тегов';
  $('accountMeta').innerHTML = [
    ['Телефон', account.phone],
    ['Страна', `${account.country.flag} ${account.country.code} (${account.country.full})`],
    ['Последняя активность', account.lastActive],
    ['API статус', account.apiStatus],
    ['Сессий', account.sessions],
    ['Диалогов', account.dialogs],
    ['Premium', account.premium ? 'Да' : 'Нет'],
    ['2FA', account.has2fa ? 'Включена' : 'Выключена'],
    ['Комментарий', account.comment],
    ['Теги', tags]
  ].map(([k, v]) => `<div class="meta-item"><small>${k}</small><div>${v}</div></div>`).join('');

  $('accountModal').classList.remove('hidden');
}

function bindTabs() {
  $('nav').querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      $('nav').querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      document.querySelector(`.tab-panel[data-panel="${state.activeTab}"]`).classList.add('active');
    });
  });
}

function bindControls() {
  $('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.page = 1;
    renderAccounts();
  });

  $('openAdvancedFilter').addEventListener('click', () => $('advancedFilterModal').classList.remove('hidden'));
  $('closeAdvancedFilter').addEventListener('click', () => $('advancedFilterModal').classList.add('hidden'));

  $('applyFilters').addEventListener('click', () => {
    state.filters = {
      valid: $('fValid').checked,
      premium: $('fPremium').checked,
      has2fa: $('f2fa').checked,
      hasUsername: $('fUsername').checked
    };
    $('advancedFilterModal').classList.add('hidden');
    state.page = 1;
    renderAccounts();
  });

  $('closeAccountModal').addEventListener('click', () => $('accountModal').classList.add('hidden'));

  $('copyIdentity').addEventListener('click', async () => {
    if (!state.selectedAccount) return;
    const value = state.selectedAccount.username ? `@${state.selectedAccount.username}` : String(state.selectedAccount.id);
    try { await navigator.clipboard.writeText(value); } catch (_) {}
    showToast('Скопировано: ' + value);
  });

  ['downloadTdata', 'downloadTelethon', 'downloadPyrogram'].forEach((id) => {
    $(id).addEventListener('click', () => {
      if (!state.selectedAccount?.valid) return showToast('Скачивание доступно только для валидных аккаунтов');
      showToast('Подготовлен экспорт: ' + id.replace('download', '').toLowerCase());
    });
  });

  $('addTagBtn').addEventListener('click', () => {
    const name = $('tagName').value.trim();
    const color = $('tagColor').value;
    if (!name) return;
    state.customTags.push({ name, color });
    localStorage.setItem('ts_custom_tags', JSON.stringify(state.customTags));
    $('tagName').value = '';
    renderTags();
    showToast('Тег добавлен');
  });
}

function renderTags() {
  $('tagsList').innerHTML = state.customTags.map((t, i) => `
    <button class="tag-chip" data-remove-tag="${i}" style="background:${t.color}22;color:${t.color};">${t.name} ✕</button>
  `).join('');

  $('tagsList').querySelectorAll('[data-remove-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.customTags.splice(Number(btn.dataset.removeTag), 1);
      localStorage.setItem('ts_custom_tags', JSON.stringify(state.customTags));
      renderTags();
    });
  });
}

async function init() {
  bindTabs();
  bindControls();
  await loadAccounts();
  renderStats();
  renderModules();
  renderTools();
  renderNumbersStats();
  renderStateTabs();
  renderAccounts();
  renderTags();
}

init();
