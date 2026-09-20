'use strict';

// ═══════════════════════════════════════════ STATE ══
const state = {
  view: 'browse',
  entries: [],
  boards: [],
  tags: [],
  types: [],
  foundVia: [],
  filters: { q: '', type: '', tags: [], board: '', favorite: false, tagMode: 'any' },
  bulkMode: false,
  selectedIds: new Set(),
  editingEntry: null,
  currentBoard: null,
  pendingScreenshotFile: null,
  detailEntry: null,
};

// ═══════════════════════════════════════════ API ══
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async uploadScreenshot(entryId, file) {
    const fd = new FormData();
    fd.append('screenshot', file);
    const r = await fetch(`/api/entries/${entryId}/screenshot`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

// ═══════════════════════════════════════════ INIT ══
async function init() {
  await loadAll();
  setupNav();
  setupTheme();
  setupSearch();
  setupFilters();
  setupBulk();
  setupAddForm();
  setupDetailModal();
  setupConfirmModal();
  setupBoardPicker();
  setupSettings();
  setupPasteImage();
  setupDynamicSelect(document.getElementById('f-type'), () => state.types, ensureType, 'New type name:');
  setupDynamicSelect(document.getElementById('f-found-via'), () => state.foundVia, ensureFoundVia, 'New "found via" name:');
  setupDynamicSelect(document.getElementById('detail-type'), () => state.types, ensureType, 'New type name:');
  setupDynamicSelect(document.getElementById('detail-found-via'), () => state.foundVia, ensureFoundVia, 'New "found via" name:');
  renderBrowse();
  refreshStats();
}

// ═══════════════════════════════════════════ PASTE IMAGE ══
function setupPasteImage() {
  document.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const item = [...items].find(i => i.type && i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    if (state.detailEntry && document.getElementById('detail-overlay').style.display !== 'none') {
      applyDetailScreenshot(file);
    } else if (state.view === 'add') {
      setScreenshotPreview(file);
    }
  });
}

async function loadAll() {
  [state.entries, state.boards, state.tags, state.types, state.foundVia] = await Promise.all([
    api.get('/api/entries'),
    api.get('/api/boards'),
    api.get('/api/tags'),
    api.get('/api/types'),
    api.get('/api/found-via')
  ]);
}

// ═══════════════════════════════════════════ DYNAMIC DROPDOWNS (Type / Found via) ══
// Populates a <select> as: "+ Add New" pinned first, then "— None —", then
// all options sorted alphabetically (the entry's current value is merged in
// so editing an entry never silently drops a value that isn't in the list yet).
function populateSelect(selectEl, options, currentValue) {
  const merged = [...options];
  if (currentValue && !merged.some(o => o.toLowerCase() === currentValue.toLowerCase())) merged.push(currentValue);
  merged.sort((a, b) => a.localeCompare(b));

  selectEl.innerHTML = '';
  const addNew = document.createElement('option');
  addNew.value = '__add_new__';
  addNew.textContent = '+ Add New';
  selectEl.appendChild(addNew);
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— None —';
  selectEl.appendChild(none);
  merged.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });

  selectEl.value = currentValue || '';
  selectEl.dataset.prev = selectEl.value;
}

// Wires the "+ Add New" sentinel: prompts for a new value, persists it, and
// re-populates the select with it chosen. Reverts to the prior value on cancel.
function setupDynamicSelect(selectEl, getOptions, ensureFn, promptLabel) {
  selectEl.addEventListener('change', async () => {
    if (selectEl.value !== '__add_new__') { selectEl.dataset.prev = selectEl.value; return; }
    const name = (prompt(promptLabel) || '').trim();
    if (name) {
      await ensureFn(name);
      populateSelect(selectEl, getOptions(), name);
    } else {
      selectEl.value = selectEl.dataset.prev || '';
    }
  });
}

// Persists a newly-added type value (mirrors how new style tags are created).
async function ensureType(value) {
  const val = (value || '').trim();
  if (!val || state.types.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.types.push(val);
  try { await api.post('/api/types', { name: val }); } catch { /* already exists server-side */ }
}

async function ensureFoundVia(value) {
  const val = (value || '').trim();
  if (!val || state.foundVia.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.foundVia.push(val);
  try { await api.post('/api/found-via', { name: val }); } catch { /* already exists server-side */ }
}

// ═══════════════════════════════════════════ NAVIGATION ══
function setupNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const v = el.dataset.view;
      navigate(v);
    });
  });
}

function navigate(view) {
  state.view = view;
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  // Show target view
  const el = document.getElementById(`view-${view}`);
  if (el) el.style.display = 'block';
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  // Render
  if (view === 'browse') renderBrowse();
  if (view === 'boards') renderBoards();
  if (view === 'favorites') renderFavorites();
  if (view === 'add') openAddForm(null);
  if (view === 'settings') renderSettings();
}

// ═══════════════════════════════════════════ THEME ══
function setupTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem('omniview-theme') || 'dark';
  setTheme(saved);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.t));
  });
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('omniview-theme', t);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}

// ═══════════════════════════════════════════ SEARCH ══
function setupSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  input.addEventListener('input', () => {
    state.filters.q = input.value.trim();
    clear.style.display = state.filters.q ? '' : 'none';
    renderBrowse();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    state.filters.q = '';
    clear.style.display = 'none';
    renderBrowse();
  });
}

// ═══════════════════════════════════════════ FILTERS ══
function setupFilters() {
  document.getElementById('filter-type').addEventListener('change', e => {
    state.filters.type = e.target.value;
    renderBrowse();
  });

  document.getElementById('filter-boards').addEventListener('change', e => {
    state.filters.board = e.target.value;
    renderBrowse();
  });

  document.getElementById('filter-fav').addEventListener('click', () => {
    state.filters.favorite = !state.filters.favorite;
    renderBrowse();
  });

  // Tag mode
  document.getElementById('tag-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.tag-mode-btn');
    if (!btn) return;
    state.filters.tagMode = btn.dataset.mode;
    document.querySelectorAll('.tag-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.filters.tagMode));
    renderBrowse();
  });

  document.getElementById('filter-tags-clear').addEventListener('click', () => {
    state.filters.tags = [];
    renderBrowse();
  });

  document.getElementById('filter-clear').addEventListener('click', () => {
    state.filters = { ...state.filters, type: '', tags: [], board: '', favorite: false };
    renderBrowse();
  });

  // Close the tag panel when clicking outside it
  document.addEventListener('click', e => {
    const dd = document.getElementById('filter-tags-dd');
    if (dd.open && !dd.contains(e.target)) dd.open = false;
  });
}

function renderTypeFilter() {
  const sel = document.getElementById('filter-type');
  sel.innerHTML = '<option value="">All Types</option>';
  [...state.types].sort((a, b) => a.localeCompare(b)).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });
  sel.value = state.filters.type;
  sel.classList.toggle('active', !!state.filters.type);
}

function renderTagFilters() {
  const wrap = document.getElementById('filter-tags');
  wrap.innerHTML = '';
  [...state.tags].sort((a, b) => a.localeCompare(b)).forEach(tag => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.filters.tags.includes(tag);
    box.addEventListener('change', () => {
      state.filters.tags = box.checked
        ? [...state.filters.tags, tag]
        : state.filters.tags.filter(t => t !== tag);
      renderBrowse();
    });
    label.appendChild(box);
    label.appendChild(document.createTextNode(tag));
    wrap.appendChild(label);
  });
  if (state.tags.length === 0) wrap.innerHTML = '<div class="filter-check-empty">No tags yet.</div>';

  const n = state.filters.tags.length;
  const count = document.getElementById('filter-tags-count');
  count.textContent = n;
  count.style.display = n ? '' : 'none';
  document.getElementById('filter-tags-clear').style.display = n ? '' : 'none';
  document.getElementById('filter-tags-dd').classList.toggle('active', n > 0);
  document.getElementById('tag-mode-toggle').style.display = n > 1 ? '' : 'none';
}

function renderBoardFilters() {
  const sel = document.getElementById('filter-boards');
  sel.style.display = state.boards.length === 0 ? 'none' : '';
  sel.innerHTML = '<option value="">All Boards</option>';
  state.boards.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
  sel.value = state.filters.board;
  sel.classList.toggle('active', !!state.filters.board);
}

// ═══════════════════════════════════════════ BROWSE ══
function applyFilters(entries) {
  let list = entries;
  const f = state.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(e =>
      e.url.toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.style_tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  if (f.type) list = list.filter(e => e.type === f.type);
  if (f.tags.length) {
    if (f.tagMode === 'all') {
      list = list.filter(e => f.tags.every(t => (e.style_tags || []).includes(t)));
    } else {
      list = list.filter(e => f.tags.some(t => (e.style_tags || []).includes(t)));
    }
  }
  if (f.board) list = list.filter(e => (e.boards || []).includes(f.board));
  if (f.favorite) list = list.filter(e => e.favorite);
  return list;
}

function renderBrowse() {
  const f = state.filters;
  renderTypeFilter();
  renderTagFilters();
  renderBoardFilters();
  document.getElementById('filter-fav').classList.toggle('active', f.favorite);
  document.getElementById('filter-clear').style.display =
    (f.type || f.tags.length || f.board || f.favorite) ? '' : 'none';

  const filtered = applyFilters(state.entries).sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  renderGrid(document.getElementById('entry-grid'), filtered, true);
  document.getElementById('browse-empty').style.display = filtered.length === 0 ? '' : 'none';
  document.getElementById('entry-grid').style.display = filtered.length === 0 ? 'none' : '';
  refreshStats();
}

function renderGrid(gridEl, entries, clickOpensDetail = true) {
  gridEl.innerHTML = '';
  entries.forEach(entry => {
    const card = createCard(entry, clickOpensDetail);
    gridEl.appendChild(card);
  });
}

function createCard(entry, clickOpensDetail) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;
  if (state.selectedIds.has(entry.id)) card.classList.add('selected');

  const isMobile = entry.type === 'Mobile App';
  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrap' + (isMobile ? ' mobile' : '');

  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `/uploads/${entry.screenshot}`;
    img.alt = entry.url;
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = `<div class="thumb-placeholder"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="5" width="24" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="12" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 19l7-5 4 3.5 3.5-2.5 9.5 6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span>No screenshot</span></div>`;
  }

  // Overlay: fav + check
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const favBtn = document.createElement('button');
  favBtn.className = 'card-fav' + (entry.favorite ? ' is-fav' : '');
  favBtn.title = entry.favorite ? 'Unfavorite' : 'Favorite';
  favBtn.textContent = '♥';
  favBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await toggleFavorite(entry.id);
  });
  overlay.appendChild(favBtn);
  thumb.appendChild(overlay);

  // Bulk check
  const check = document.createElement('div');
  check.className = 'card-check';
  check.textContent = '✓';
  thumb.appendChild(check);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';
  const urlEl = document.createElement('div');
  urlEl.className = 'card-url';
  urlEl.textContent = entry.title || cleanUrl(entry.url);
  urlEl.title = entry.url;
  body.appendChild(urlEl);

  if ((entry.style_tags || []).length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    entry.style_tags.slice(0, 3).forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = t;
      tagsEl.appendChild(tag);
    });
    if (entry.style_tags.length > 3) {
      const more = document.createElement('span');
      more.className = 'card-tag';
      more.textContent = `+${entry.style_tags.length - 3}`;
      tagsEl.appendChild(more);
    }
    body.appendChild(tagsEl);
  }

  card.appendChild(thumb);
  card.appendChild(body);

  card.addEventListener('click', e => {
    if (state.bulkMode) {
      toggleSelect(entry.id, card);
      return;
    }
    if (clickOpensDetail) openDetail(entry.id);
  });

  return card;
}

function cleanUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ═══════════════════════════════════════════ BULK ══
function setupBulk() {
  document.getElementById('bulk-toggle').addEventListener('click', () => {
    state.bulkMode = !state.bulkMode;
    state.selectedIds.clear();
    document.getElementById('bulk-toggle').classList.toggle('active', state.bulkMode);
    document.getElementById('bulk-bar').style.display = state.bulkMode ? '' : 'none';
    document.querySelector('.entry-grid').classList.toggle('bulk-mode', state.bulkMode);
    renderBrowse();
  });

  document.getElementById('bulk-cancel').addEventListener('click', () => {
    state.bulkMode = false;
    state.selectedIds.clear();
    document.getElementById('bulk-toggle').classList.remove('active');
    document.getElementById('bulk-bar').style.display = 'none';
    document.querySelector('.entry-grid').classList.remove('bulk-mode');
    renderBrowse();
  });

  document.getElementById('bulk-apply-tag').addEventListener('click', async () => {
    const tag = document.getElementById('bulk-tag-select').value;
    if (!tag || state.selectedIds.size === 0) return;
    await api.post('/api/entries/bulk', { ids: [...state.selectedIds], action: 'tag', tag });
    state.entries = await api.get('/api/entries');
    state.selectedIds.clear();
    updateBulkCount();
    renderBrowse();
  });

  document.getElementById('bulk-delete').addEventListener('click', () => {
    if (state.selectedIds.size === 0) return;
    confirm_(`Delete ${state.selectedIds.size} selected entries? This cannot be undone.`, async () => {
      await api.post('/api/entries/bulk', { ids: [...state.selectedIds], action: 'delete' });
      state.entries = await api.get('/api/entries');
      state.selectedIds.clear();
      state.bulkMode = false;
      document.getElementById('bulk-toggle').classList.remove('active');
      document.getElementById('bulk-bar').style.display = 'none';
      document.querySelector('.entry-grid').classList.remove('bulk-mode');
      updateBulkCount();
      renderBrowse();
    });
  });
}

function toggleSelect(id, card) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    card.classList.remove('selected');
  } else {
    state.selectedIds.add(id);
    card.classList.add('selected');
  }
  updateBulkCount();
}

function updateBulkCount() {
  document.getElementById('bulk-count').textContent = `${state.selectedIds.size} selected`;
  // Populate tag dropdown
  const sel = document.getElementById('bulk-tag-select');
  sel.innerHTML = '<option value="">Add tag…</option>';
  [...state.tags].sort((a, b) => a.localeCompare(b)).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
}

// ═══════════════════════════════════════════ FAVORITES ══
async function toggleFavorite(id) {
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const updated = await api.put(`/api/entries/${id}`, { favorite: !state.entries[idx].favorite });
  state.entries[idx] = updated;
  renderBrowse();
  if (state.view === 'favorites') renderFavorites();
  refreshStats();
}

function renderFavorites() {
  const favs = state.entries.filter(e => e.favorite).sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  renderGrid(document.getElementById('fav-grid'), favs);
  document.getElementById('fav-empty').style.display = favs.length === 0 ? '' : 'none';
}

// ═══════════════════════════════════════════ BOARDS ══
function renderBoards() {
  // Reset board detail
  document.getElementById('boards-grid').style.display = '';
  document.getElementById('board-detail').style.display = 'none';
  document.getElementById('boards-title').textContent = 'Boards';
  document.getElementById('new-board-btn').style.display = '';

  const grid = document.getElementById('boards-grid');
  grid.innerHTML = '';
  const empty = document.getElementById('boards-empty');

  if (state.boards.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  state.boards.forEach(board => {
    const count = state.entries.filter(e => (e.boards || []).includes(board.id)).length;
    const card = document.createElement('div');
    card.className = 'board-card';
    card.innerHTML = `<div class="board-name">${escHtml(board.name)}</div><div class="board-count">${count} entr${count === 1 ? 'y' : 'ies'}</div>`;
    card.addEventListener('click', () => openBoard(board));
    grid.appendChild(card);
  });

  // Update nav badge
  document.getElementById('nav-boards-count').textContent = state.boards.length || '';
}

function openBoard(board) {
  state.currentBoard = board;
  document.getElementById('boards-grid').style.display = 'none';
  document.getElementById('boards-empty').style.display = 'none';
  document.getElementById('new-board-btn').style.display = 'none';
  document.getElementById('boards-title').textContent = board.name;
  document.getElementById('board-detail').style.display = '';

  document.getElementById('add-to-board-btn').onclick = () => openBoardPicker(board);

  document.getElementById('rename-board-btn').onclick = async () => {
    const name = prompt('New board name:', board.name);
    if (!name || name === board.name) return;
    const updated = await api.put(`/api/boards/${board.id}`, { name });
    const idx = state.boards.findIndex(b => b.id === board.id);
    state.boards[idx] = updated;
    document.getElementById('boards-title').textContent = updated.name;
    state.currentBoard = updated;
    updateFormBoardChips();
    renderBoardFilters();
  };

  document.getElementById('delete-board-btn').onclick = () => {
    confirm_(`Delete board "${board.name}"? Entries will not be deleted.`, async () => {
      await api.del(`/api/boards/${board.id}`);
      state.boards = state.boards.filter(b => b.id !== board.id);
      state.entries.forEach(e => { e.boards = (e.boards || []).filter(id => id !== board.id); });
      renderBoards();
      updateFormBoardChips();
      renderBoardFilters();
    });
  };

  const entries = state.entries.filter(e => (e.boards || []).includes(board.id));
  renderGrid(document.getElementById('board-entry-grid'), entries);
  document.getElementById('board-empty').style.display = entries.length === 0 ? '' : 'none';
}

// ── Board picker: add existing entries to the currently open board ──
function setupBoardPicker() {
  document.getElementById('board-picker-cancel').addEventListener('click', closeBoardPicker);
  document.getElementById('board-picker-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('board-picker-overlay')) closeBoardPicker();
  });

  document.getElementById('board-picker-add').addEventListener('click', async () => {
    const board = state.currentBoard;
    if (!board) return;
    const ids = [...document.querySelectorAll('#board-picker-list input:checked')].map(el => el.value);
    if (ids.length === 0) { closeBoardPicker(); return; }
    await api.post('/api/entries/bulk', { ids, action: 'addToBoard', boards: board.id });
    ids.forEach(id => {
      const entry = state.entries.find(e => e.id === id);
      if (entry && !(entry.boards || []).includes(board.id)) entry.boards.push(board.id);
    });
    closeBoardPicker();
    openBoard(board);
    renderBoardFilters();
  });
}

function openBoardPicker(board) {
  const list = document.getElementById('board-picker-list');
  list.innerHTML = '';
  const available = state.entries.filter(e => !(e.boards || []).includes(board.id));

  if (available.length === 0) {
    list.innerHTML = '<div class="board-picker-empty">Every entry is already on this board.</div>';
  } else {
    available.forEach(entry => {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.innerHTML = `<input type="checkbox" value="${entry.id}"><span class="checkmark"></span>${escHtml(cleanUrl(entry.url))}`;
      list.appendChild(label);
    });
  }

  document.getElementById('board-picker-overlay').style.display = '';
}

function closeBoardPicker() {
  document.getElementById('board-picker-overlay').style.display = 'none';
}

document.getElementById('board-back').addEventListener('click', () => {
  state.currentBoard = null;
  renderBoards();
});

document.getElementById('new-board-btn').addEventListener('click', async () => {
  const name = prompt('Board name:');
  if (!name) return;
  const board = await api.post('/api/boards', { name });
  state.boards.push(board);
  renderBoards();
  updateFormBoardChips();
  renderBoardFilters();
});

// ═══════════════════════════════════════════ ADD / EDIT FORM ══
let formSelectedTags = [];
let formSelectedBoards = new Set();

function openAddForm(entry) {
  document.getElementById('add-view-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
  document.getElementById('form-submit').textContent = entry ? 'Save Changes' : 'Save Entry';
  state.editingEntry = entry;
  state.pendingScreenshotFile = null;

  // Reset form
  document.getElementById('f-title').value = entry ? (entry.title || '') : '';
  document.getElementById('f-url').value = entry ? entry.url : '';
  populateSelect(document.getElementById('f-type'), state.types, entry ? (entry.type || '') : '');
  document.getElementById('f-color').value = entry ? (entry.color || '') : '';
  populateSelect(document.getElementById('f-found-via'), state.foundVia, entry ? (entry.found_via || '') : '');
  document.getElementById('f-note').value = entry ? (entry.note || '') : '';
  document.getElementById('f-favorite').checked = entry ? !!entry.favorite : false;
  document.getElementById('edit-entry-id').value = entry ? entry.id : '';
  document.getElementById('dupe-warning').style.display = 'none';

  // Mutate in place (not `formSelectedTags = [...]`) so the array reference
  // captured by setupTagInput's closures stays valid — see renderFormTagPills.
  formSelectedTags.length = 0;
  formSelectedTags.push(...(entry ? (entry.style_tags || []) : []));
  formSelectedBoards = new Set(entry ? (entry.boards || []) : []);

  renderFormTagPills();
  updateFormBoardChips();
  updateDropZoneForEdit(entry);
}

function updateDropZoneForEdit(entry) {
  const inner = document.getElementById('drop-zone-inner');
  const preview = document.getElementById('drop-preview');
  const clearBtn = document.getElementById('drop-clear');

  if (entry && entry.screenshot) {
    inner.style.display = 'none';
    preview.src = `/uploads/${entry.screenshot}`;
    preview.style.display = '';
    clearBtn.style.display = '';
  } else {
    inner.style.display = '';
    preview.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

function setupAddForm() {
  // Drop zone
  const zone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('screenshot-file');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) setScreenshotPreview(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setScreenshotPreview(fileInput.files[0]);
  });

  document.getElementById('drop-clear').addEventListener('click', () => {
    state.pendingScreenshotFile = null;
    fileInput.value = '';
    document.getElementById('drop-zone-inner').style.display = '';
    document.getElementById('drop-preview').style.display = 'none';
    document.getElementById('drop-clear').style.display = 'none';
    // If editing, mark screenshot for removal
    if (state.editingEntry) state.editingEntry._removeScreenshot = true;
  });

  // URL blur: duplicate check
  document.getElementById('f-url').addEventListener('blur', async () => {
    const url = document.getElementById('f-url').value.trim();
    if (!url || (state.editingEntry && state.editingEntry.url === url)) {
      document.getElementById('dupe-warning').style.display = 'none';
      return;
    }
    const dupe = state.entries.find(e => e.url === url && e.id !== (state.editingEntry?.id));
    document.getElementById('dupe-warning').style.display = dupe ? '' : 'none';
  });

  // Tag search
  setupTagInput('tag-search', 'tag-dropdown', 'tag-pills', formSelectedTags, renderFormTagPills);

  // Form boards
  updateFormBoardChips();

  // Cancel
  document.getElementById('form-cancel').addEventListener('click', () => {
    history.back();
    if (state.view === 'add') navigate('browse');
  });

  // Submit
  document.getElementById('entry-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url = document.getElementById('f-url').value.trim();
    if (!url) return;

    const payload = {
      title: document.getElementById('f-title').value.trim(),
      url,
      type: document.getElementById('f-type').value || null,
      color: document.getElementById('f-color').value || null,
      found_via: document.getElementById('f-found-via').value,
      note: document.getElementById('f-note').value.trim(),
      favorite: document.getElementById('f-favorite').checked,
      style_tags: formSelectedTags,
      boards: [...formSelectedBoards]
    };

    let entry;
    if (state.editingEntry) {
      entry = await api.put(`/api/entries/${state.editingEntry.id}`, payload);
      const idx = state.entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) state.entries[idx] = entry;
    } else {
      const res = await api.post('/api/entries', payload);
      entry = res.entry;
      state.entries.unshift(entry);
    }

    // Upload screenshot if pending
    if (state.pendingScreenshotFile) {
      const { screenshot } = await api.uploadScreenshot(entry.id, state.pendingScreenshotFile);
      const idx = state.entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) state.entries[idx].screenshot = screenshot;
    }

    state.editingEntry = null;
    state.pendingScreenshotFile = null;
    navigate('browse');
    refreshStats();
  });
}

function setScreenshotPreview(file) {
  state.pendingScreenshotFile = file;
  const url = URL.createObjectURL(file);
  document.getElementById('drop-zone-inner').style.display = 'none';
  const preview = document.getElementById('drop-preview');
  preview.src = url;
  preview.style.display = '';
  document.getElementById('drop-clear').style.display = '';
}

function renderFormTagPills() {
  renderTagPills(document.getElementById('tag-pills'), formSelectedTags, tag => {
    const i = formSelectedTags.indexOf(tag);
    if (i !== -1) formSelectedTags.splice(i, 1);
    renderFormTagPills();
  });
}

function renderTagPills(container, tags, onRemove) {
  container.innerHTML = '';
  tags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button type="button" aria-label="Remove ${tag}">✕</button>`;
    pill.querySelector('button').addEventListener('click', () => onRemove(tag));
    container.appendChild(pill);
  });
}

function updateFormBoardChips() {
  const wrap = document.getElementById('form-boards');
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = '<span style="font-size:.75rem;color:var(--text-3)">No boards yet — create one in the Boards view.</span>';
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (formSelectedBoards.has(b.id) ? ' selected' : '');
    chip.textContent = b.name;
    chip.addEventListener('click', () => {
      if (formSelectedBoards.has(b.id)) formSelectedBoards.delete(b.id);
      else formSelectedBoards.add(b.id);
      chip.classList.toggle('selected', formSelectedBoards.has(b.id));
    });
    wrap.appendChild(chip);
  });
}

// ═══════════════════════════════════════════ TAG INPUT WIDGET ══
function setupTagInput(inputId, dropdownId, pillsId, tagsArr, onUpdate) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  input.addEventListener('input', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('focus', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !tagsArr.includes(val)) {
        tagsArr.push(val);
        // Add new tag globally if not exists
        if (!state.tags.includes(val)) {
          state.tags.push(val);
          api.post('/api/tags', { name: val }).catch(() => {});
        }
        input.value = '';
        dropdown.style.display = 'none';
        onUpdate();
      }
    }
    if (e.key === 'Escape') { dropdown.style.display = 'none'; }
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

function renderTagDropdown(input, dropdown, tagsArr, onUpdate) {
  const q = input.value.toLowerCase();
  const available = state.tags
    .filter(t => !tagsArr.includes(t) && t.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
  dropdown.innerHTML = '';

  // "+ Add New" is always pinned first; typed text (if any) is offered as the default name.
  const addNew = document.createElement('div');
  addNew.className = 'tag-dropdown-item create';
  addNew.textContent = '+ Add New';
  addNew.addEventListener('mousedown', e => {
    e.preventDefault();
    const val = (prompt('New style tag name:', input.value.trim()) || '').trim();
    if (val && !tagsArr.includes(val)) {
      tagsArr.push(val);
      if (!state.tags.includes(val)) {
        state.tags.push(val);
        api.post('/api/tags', { name: val }).catch(() => {});
      }
    }
    input.value = '';
    dropdown.style.display = 'none';
    onUpdate();
  });
  dropdown.appendChild(addNew);

  available.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item';
    item.textContent = tag;
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      tagsArr.push(tag);
      input.value = '';
      dropdown.style.display = 'none';
      onUpdate();
    });
    dropdown.appendChild(item);
  });

  dropdown.style.display = '';
}

// ═══════════════════════════════════════════ DETAIL MODAL ══
let detailTags = [];
let detailBoards = new Set();

async function applyDetailScreenshot(file) {
  if (!state.detailEntry) return;
  const { screenshot } = await api.uploadScreenshot(state.detailEntry.id, file);
  const idx = state.entries.findIndex(en => en.id === state.detailEntry.id);
  if (idx !== -1) state.entries[idx].screenshot = screenshot;
  state.detailEntry.screenshot = screenshot;
  document.getElementById('detail-screenshot').src = `/uploads/${screenshot}?t=${Date.now()}`;
  document.getElementById('detail-screenshot').style.display = '';
  document.getElementById('detail-no-screenshot').style.display = 'none';
}

function setupDetailModal() {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-overlay')) closeDetail();
  });

  document.getElementById('detail-fav').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    await toggleFavorite(state.detailEntry.id);
    state.detailEntry = state.entries.find(e => e.id === state.detailEntry.id);
    document.getElementById('detail-fav').classList.toggle('is-fav', state.detailEntry?.favorite);
  });

  // Screenshot upload in detail
  document.getElementById('detail-screenshot-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await applyDetailScreenshot(file);
  });

  // Tag input in detail
  setupTagInput('detail-tag-search', 'detail-tag-dropdown', 'detail-tag-pills', detailTags, renderDetailTagPills);

  document.getElementById('detail-save').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    const payload = {
      title: document.getElementById('detail-title').value.trim(),
      url: state.detailEntry.url,
      type: document.getElementById('detail-type').value || null,
      color: document.getElementById('detail-color').value || null,
      found_via: document.getElementById('detail-found-via').value,
      note: document.getElementById('detail-note').value.trim(),
      favorite: state.detailEntry.favorite,
      style_tags: detailTags,
      boards: [...detailBoards]
    };
    const updated = await api.put(`/api/entries/${state.detailEntry.id}`, payload);
    const idx = state.entries.findIndex(e => e.id === updated.id);
    if (idx !== -1) state.entries[idx] = updated;
    state.detailEntry = updated;
    closeDetail();
    renderBrowse();
  });

  document.getElementById('detail-delete').addEventListener('click', () => {
    if (!state.detailEntry) return;
    confirm_(`Delete this entry? This cannot be undone.`, async () => {
      await api.del(`/api/entries/${state.detailEntry.id}`);
      state.entries = state.entries.filter(e => e.id !== state.detailEntry.id);
      closeDetail();
      renderBrowse();
      refreshStats();
    });
  });
}

async function openDetail(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.detailEntry = entry;
  // Mutate in place — see the comment in openAddForm for why reassigning breaks the tag dropdown.
  detailTags.length = 0;
  detailTags.push(...(entry.style_tags || []));
  detailBoards = new Set(entry.boards || []);

  document.getElementById('detail-url').href = entry.url;
  document.getElementById('detail-url').textContent = entry.url;
  document.getElementById('detail-fav').classList.toggle('is-fav', !!entry.favorite);
  document.getElementById('detail-title').value = entry.title || '';
  populateSelect(document.getElementById('detail-type'), state.types, entry.type || '');
  document.getElementById('detail-color').value = entry.color || '';
  populateSelect(document.getElementById('detail-found-via'), state.foundVia, entry.found_via || '');
  document.getElementById('detail-note').value = entry.note || '';
  document.getElementById('detail-date').textContent = new Date(entry.date_added).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  if (entry.screenshot) {
    document.getElementById('detail-screenshot').src = `/uploads/${entry.screenshot}`;
    document.getElementById('detail-screenshot').style.display = '';
    document.getElementById('detail-no-screenshot').style.display = 'none';
  } else {
    document.getElementById('detail-screenshot').style.display = 'none';
    document.getElementById('detail-no-screenshot').style.display = '';
  }

  renderDetailTagPills();
  renderDetailBoardChips();

  document.getElementById('detail-overlay').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').style.display = 'none';
  document.body.style.overflow = '';
  state.detailEntry = null;
}

function renderDetailTagPills() {
  renderTagPills(document.getElementById('detail-tag-pills'), detailTags, tag => {
    const i = detailTags.indexOf(tag);
    if (i !== -1) detailTags.splice(i, 1);
    renderDetailTagPills();
  });
}

function renderDetailBoardChips() {
  const wrap = document.getElementById('detail-boards');
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = '<span style="font-size:.75rem;color:var(--text-3)">No boards yet.</span>';
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (detailBoards.has(b.id) ? ' selected' : '');
    chip.textContent = b.name;
    chip.addEventListener('click', () => {
      if (detailBoards.has(b.id)) detailBoards.delete(b.id);
      else detailBoards.add(b.id);
      chip.classList.toggle('selected', detailBoards.has(b.id));
    });
    wrap.appendChild(chip);
  });
}

// ═══════════════════════════════════════════ CONFIRM MODAL ══
let confirmCallback = null;

function setupConfirmModal() {
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').style.display = 'none';
    confirmCallback = null;
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('confirm-overlay').style.display = 'none';
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
  });
}

function confirm_(msg, cb) {
  document.getElementById('confirm-body').textContent = msg;
  document.getElementById('confirm-overlay').style.display = '';
  confirmCallback = cb;
}

// ═══════════════════════════════════════════ SETTINGS ══
function setupSettings() {
  document.getElementById('add-tag-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-tag-input');
    const name = input.value.trim();
    if (!name) return;
    try {
      const res = await api.post('/api/tags', { name });
      state.tags = res.tags;
      input.value = '';
      renderTagList();
      renderTagFilters();
    } catch { alert('Tag already exists.'); }
  });
  document.getElementById('new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
  });

  setupOptionAdder('new-type-input', 'add-type-btn', () => state.types, ensureType, renderTypeList);
  setupOptionAdder('new-found-via-input', 'add-found-via-btn', () => state.foundVia, ensureFoundVia, renderFoundViaList);

  document.getElementById('reset-btn').addEventListener('click', () => {
    confirm_('Factory reset? ALL entries, boards, and tags will be permanently deleted. This cannot be undone.', async () => {
      await api.post('/api/reset', {});
      await loadAll();
      renderBrowse();
      renderSettings();
      refreshStats();
    });
  });
}

function renderSettings() {
  renderTagList();
  renderTypeList();
  renderFoundViaList();
  // Sync theme buttons
  const t = document.documentElement.dataset.theme;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}

function renderTagList() {
  const list = document.getElementById('tag-list');
  list.innerHTML = '';
  [...state.tags].sort().forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-list-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = tag;

    const actions = document.createElement('div');
    actions.className = 'tag-list-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'tag-action-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      // Inline rename
      nameSpan.style.display = 'none';
      const inp = document.createElement('input');
      inp.value = tag;
      item.insertBefore(inp, actions);
      inp.focus();
      const save = async () => {
        const newName = inp.value.trim();
        if (newName && newName !== tag) {
          const res = await api.put(`/api/tags/${encodeURIComponent(tag)}`, { newName });
          state.tags = res.tags;
          state.entries.forEach(e => {
            e.style_tags = (e.style_tags || []).map(t => t === tag ? newName : t);
          });
        }
        inp.remove();
        nameSpan.style.display = '';
        renderTagList();
        renderTagFilters();
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { inp.remove(); nameSpan.style.display = ''; } });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'tag-action-btn del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      confirm_(`Delete tag "${tag}"? It will be removed from all entries.`, async () => {
        const res = await api.del(`/api/tags/${encodeURIComponent(tag)}`);
        state.tags = res.tags;
        state.entries.forEach(e => { e.style_tags = (e.style_tags || []).filter(t => t !== tag); });
        renderTagList();
        renderTagFilters();
      });
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    item.appendChild(nameSpan);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function setupOptionAdder(inputId, buttonId, getOptions, ensureFn, onAdded) {
  const input = document.getElementById(inputId);
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    if (getOptions().some(o => o.toLowerCase() === name.toLowerCase())) { alert('That option already exists.'); return; }
    await ensureFn(name);
    input.value = '';
    onAdded();
  };
  document.getElementById(buttonId).addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

// Delete-only manager list, shared by the Entry Types and Found Via sections.
// The confirm message states how many entries lose the value, since unlike a
// style tag these live in a single-value field that gets cleared outright.
function renderManagedList(listId, items, countUsage, onDelete) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="tag-list-empty">None yet.</div>';
    return;
  }
  [...items].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const item = document.createElement('div');
    item.className = 'tag-list-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    item.appendChild(nameSpan);

    const used = countUsage(name);
    if (used) {
      const hint = document.createElement('small');
      hint.className = 'tag-list-use';
      hint.textContent = `${used} ${used === 1 ? 'entry' : 'entries'}`;
      item.appendChild(hint);
    }

    const actions = document.createElement('div');
    actions.className = 'tag-list-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'tag-action-btn del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      const tail = used
        ? `It will be cleared from ${used} ${used === 1 ? 'entry' : 'entries'}.`
        : 'No entries use it.';
      confirm_(`Delete "${name}"? ${tail}`, () => onDelete(name));
    });
    actions.appendChild(delBtn);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function renderTypeList() {
  renderManagedList(
    'type-list',
    state.types,
    name => state.entries.filter(e => e.type === name).length,
    async name => {
      const res = await api.del(`/api/types/${encodeURIComponent(name)}`);
      state.types = res.types;
      state.entries.forEach(e => { if (e.type === name) e.type = null; });
      if (state.filters.type === name) state.filters.type = '';
      renderTypeList();
      renderBrowse();
    }
  );
}

function renderFoundViaList() {
  renderManagedList(
    'found-via-list',
    state.foundVia,
    name => state.entries.filter(e => e.found_via === name).length,
    async name => {
      const res = await api.del(`/api/found-via/${encodeURIComponent(name)}`);
      state.foundVia = res.foundVia;
      state.entries.forEach(e => { if (e.found_via === name) e.found_via = ''; });
      renderFoundViaList();
    }
  );
}

// ═══════════════════════════════════════════ STATS ══
async function refreshStats() {
  try {
    const stats = await api.get('/api/stats');
    document.getElementById('stats-line').textContent = `${stats.entries} entries`;
    document.getElementById('nav-fav-count').textContent = stats.favorites || '';
    document.getElementById('nav-boards-count').textContent = stats.boards || '';
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════ UTILS ══
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════ BOOT ══
document.addEventListener('DOMContentLoaded', init);
