const MAX_CHAR_LEVEL = 10;
function getEl(id) {
  const el = document.getElementById(id);
  return el ? el : null;   // returns null if not found
}

function debounce(fn, delay = 100) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function initSearchClear(inputId, onClear) {
  const input = getEl(inputId);
  if (!input) return;

  // Wrap input in a div if not already wrapped
  if (!input.parentElement.classList.contains('search-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    // Preserve flex/min-width styles from the input
    wrap.style.flex = input.style.flex || '1';
    wrap.style.minWidth = input.style.minWidth || '160px';
    input.style.flex = '';
    input.style.minWidth = '';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const btn = document.createElement('button');
  btn.className = 'search-clear';
  btn.textContent = '✕';
  btn.title = 'Clear search';
  input.parentElement.appendChild(btn);

  input.addEventListener('input', () => {
    btn.classList.toggle('visible', input.value.length > 0);
  });

  btn.addEventListener('click', () => {
    input.value = '';
    btn.classList.remove('visible');
    input.focus();
    onClear();
  });
}

const renderCharsDebounced = debounce(renderChars);
const renderAttractionsDebounced = debounce(renderAttractions);
const renderQuestsDebounced = debounce(renderQuests);
const renderConcessionsDebounced = debounce(renderConcessions);
const renderCostumesDebounced = debounce(renderCostumes);
const renderDecorationsDebounced = debounce(renderDecorations);
const renderEnchantmentsTabDebounced = debounce(renderEnchantmentsTab);
const renderFloatsDebounced = debounce(renderFloats);
const renderTokensDebounced = debounce(renderTokens);

function showToast(msg, type = 'info') {
  let container = getEl('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      display:flex;flex-direction:column;align-items:center;gap:8px;
      z-index:9999;pointer-events:none;`;
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'warn' ? 'rgba(245,158,11,0.95)'
    : type === 'error' ? 'rgba(239,68,68,0.95)'
      : 'rgba(57,232,124,0.95)';
  toast.style.cssText = `
    background:${bg};color:#fff;font-family:'Nunito',sans-serif;
    font-size:13px;font-weight:700;padding:10px 18px;border-radius:12px;
    box-shadow:0 4px 20px rgba(0,0,0,0.35);pointer-events:auto;
    animation:toastIn 0.25s ease;max-width:320px;text-align:center;`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TYPE_MAP = { s: 'storyline', p: 'premium', e: 'event' };

function getTokenSources(n) { return TOKEN_SOURCES[n.replace(/ Token$/, "")] || TOKEN_SOURCES[n] || []; }

// ============ FILTER STATE ============
let tokFilter = 'all';
let floatFilter = 'all';
let conOwnerFilter = 'all';
let encBuiltFilter = 'all';

// ============ STATE ============
let state = {
  characters: [],
  quests: [],
  resources: { magic: 0, gems: 0, tokens: 0, rare: 0 },
  attractions: [],
  costumes: [],
  decorations_owned: {},
};

// ============ LOAD / SAVE ============
// Build canonical character list from DMK_CHARS
function buildAllChars() {
  return DMK_CHARS.map(([name, collection, typeCode, emoji]) => ({
    id: 'char_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    name, collection,
    type: TYPE_MAP[typeCode] || 'storyline',
    emoji: emoji || '🎪',
    level: 0,
    max: MAX_CHAR_LEVEL,
    welcomed: false
  }));
}

function loadState() {
  const allChars = buildAllChars();
  try {
    const saved = localStorage.getItem('dmk-tracker-v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
      // Merge: keep saved progress, add any new chars from DB as unwelcomed
      const savedByName = {};
      (state.characters || []).forEach(c => { savedByName[c.name] = c; });
      state.characters = allChars.map(ch => {
        const savedChar = savedByName[ch.name];
        if (savedChar) {
          const { id: _, ...savedWithoutId } = savedChar; // Exclude old id
          return { ...ch, ...savedWithoutId, level: parseInt(savedChar.level) || 0 };
        }
        return ch;
      });

      // One-time migration: rekey index-based char IDs to name-based IDs
      const needsCharMigration = state.characters.some(c => /^char_\d+$/.test(c.id));
      const needsWishlistMigration = state.wishlist && Object.keys(state.wishlist).some(id => /^char_\d+$/.test(id));
      if (needsCharMigration || needsWishlistMigration) {
        DMK_CHARS.forEach(([name], i) => {
          const oldId = 'char_' + i;
          const newId = 'char_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (state.wishlist?.[oldId]) {
            state.wishlist[newId] = state.wishlist[oldId];
            delete state.wishlist[oldId];
          }
        });
      }

      // One-time migration: rekey double-prefixed quest IDs to single-prefixed
      if (state.quests?.some(q => /^[a-z0-9_]+_[a-z0-9_]+_\d+$/.test(q.id) && q.id.split('_').length > 3)) {
        state.quests = state.quests.map(q => {
          const arc = STORYLINE_ARCS.find(a => q.id.startsWith(a.id + '_' + a.id + '_'));
          if (arc) {
            const i = q.id.slice((arc.id + '_' + arc.id + '_').length);
            return { ...q, id: arc.id + '_' + i };
          }
          return q;
        });
      }

      if (!state.decorations_owned) state.decorations_owned = {};
    } else {
      state.characters = allChars;
      state.quests = [];
      state.decorations_owned = {};
    }
  } catch (e) {
    state.characters = allChars;
    state.quests = [];
    state.decorations_owned = {};
  }
  // Clean up wishlist to only include characters that currently exist
  if (state.wishlist) {
    const existingIds = new Set(state.characters.map(c => c.id));
    Object.keys(state.wishlist).forEach(id => {
      if (!existingIds.has(id)) {
        delete state.wishlist[id];
      }
    });
  }
}

const persistState = debounce(() => {
  try {
    localStorage.setItem('dmk-tracker-v2', JSON.stringify(state));
  } catch (e) {
    showToast('⚠️ Storage full — your progress wasn\'t saved. Please export a backup!', 'warn');
  }
}, 300);

function saveState() {
  const fields = ['magic', 'gems', 'dreamsparks'];
  fields.forEach(f => {
    const el = getEl('res-' + f);
    if (el) state.resources[f] = Number(el.value) || 0;
  });
  persistState();
}

function collIcon(collection, size = 20) {
  const file = COLLECTION_ICONS[collection];
  if (!file) return '';
  const url = `https://disneymagicalkingdoms.fandom.com/wiki/Special:FilePath/${file}`;
  return `<img src="${url}" alt="${collection}" style="width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">`;
}

function charImg(name, size) {
  size = size || 40;
  const url = CHAR_URLS[name];
  if (!url) return '';
  const s = size + 'px';
  return `<img src="${url}" alt="${name}" style="width:${s};height:${s};object-fit:contain;" onerror="this.style.display='none'">`;
}

// ---- Collection helpers ----
function getAllCollections() {
  return [...new Set(DMK_CHARS.map(ch => ch[1]))].filter(Boolean).sort();
}

let _lastCollList = '';
function populateCollFilter() {
  const sel = getEl('collection-filter');
  if (!sel) return;
  const cols = getAllCollections();
  const key = cols.join('|');
  if (key === _lastCollList) return; // no change, skip rebuild
  _lastCollList = key;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Collections</option>' +
    cols.map(col => `<option value="${col}" ${col === current ? 'selected' : ''}>${col}</option>`).join('');
}

// ---- end collection helpers ----

// ============ CHARACTERS ============


function levelUp(id) {
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  if (!c.welcomed) {
    c.welcomed = true;
    c.level = 1;
  } else {
    const currentLevel = parseInt(c.level);
    if (currentLevel < MAX_CHAR_LEVEL) c.level = currentLevel + 1;
  }
  saveState();
  renderChars();
}

function levelDown(id) {
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  const currentLevel = parseInt(c.level);
  if (currentLevel > 0) {
    c.level = currentLevel - 1;
    if (c.level === 0) c.welcomed = false;
  }
  saveState();
  renderChars();
}

function toggleWishlist(id) {
  const c = state.characters.find(x => x.id === id);
  if (!c || c.welcomed) return;
  if (!state.wishlist) state.wishlist = {};
  state.wishlist[id] = !state.wishlist[id];
  saveState();
  renderChars();
}

function welcomeChar(id) {
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  c.welcomed = true;
  if (c.level === 0) c.level = 1;
  if (state.wishlist) delete state.wishlist[c.id];
  saveState();
  renderChars();
}

function removeChar(id) {
  const ch = state.characters.find(x => x.id === id);
  if (!ch) return;
  ch.welcomed = false;
  ch.level = 0;
  saveState();
  renderChars();
}

let charFilter = 'all';

function filterChars(f, btn) {
  charFilter = f;
  document.querySelectorAll('#tab-characters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderChars();
}

function renderChars() {
  const grid = getEl('char-grid');
  const searchQ = (getEl('char-search-input')?.value || '').trim().toLowerCase();

  let chars = state.characters;
  if (charFilter === 'welcomed') chars = chars.filter(c => c.welcomed);
  if (charFilter === 'not-welcomed') chars = chars.filter(c => !c.welcomed);
  if (charFilter === 'wishlist') chars = chars.filter(c => !c.welcomed && state.wishlist?.[c.id]);
  if (charFilter === 'needs-level') chars = chars.filter(c => c.welcomed && parseInt(c.level) < MAX_CHAR_LEVEL);
  if (charFilter === 'maxed') chars = chars.filter(c => c.welcomed && parseInt(c.level) >= MAX_CHAR_LEVEL);
  if (charFilter === 'storyline') chars = chars.filter(c => c.type === 'storyline');
  if (charFilter === 'event') chars = chars.filter(c => c.type === 'event');
  if (charFilter === 'premium') chars = chars.filter(c => c.type === 'premium');
  if (searchQ) chars = chars.filter(c => c.name.toLowerCase().includes(searchQ) || (c.collection || '').toLowerCase().includes(searchQ));

  populateCollFilter();

  const collFilter = getEl('collection-filter')?.value || '';
  if (collFilter) chars = chars.filter(c => (c.collection || '') === collFilter);

  if (grid) {
    if (!chars.length) {
      grid.innerHTML = `<div class="empty-state" id="char-empty"><div class="es-icon">🏰</div><p>No characters match this filter.</p></div>`;
      return;
    }

    grid.innerHTML = chars.map(c => {
      const level = parseInt(c.level) || 0;
      const pct = (level / MAX_CHAR_LEVEL) * 100;
      const maxed = c.welcomed && level >= MAX_CHAR_LEVEL;
      const typeLabel = c.type === 'storyline' ? '📖 Storyline' : c.type === 'premium' ? '💎 Premium' : '🎉 Event';
      const collLabel = c.collection || '—';
      let actionBtn = '';
      if (!c.welcomed) {
        actionBtn = `<button class="btn-sm btn-welcome" data-action="welcome" data-id="${c.id}">Welcome</button>`;
      } else if (maxed) {
        actionBtn = `<button class="btn-sm btn-plus" style="background:var(--gold);cursor:default;opacity:0.8;" disabled>★ MAX</button>`;
      } else {
        actionBtn = `<button class="btn-sm btn-plus" data-action="levelup" data-id="${c.id}">+Lvl</button>`;
      }
      const isWishlisted = !c.welcomed && state.wishlist?.[c.id];
      return `
    <div class="char-card ${c.welcomed ? 'welcomed' : 'not-welcomed'} ${maxed ? 'maxed' : ''}" style="position:relative;">
      ${!c.welcomed ? `<button onclick="toggleWishlist('${c.id}')" title="${isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}" style="position:absolute;top:5px;right:5px;background:none;border:none;cursor:pointer;font-size:15px;line-height:1;padding:2px;z-index:2;">${isWishlisted ? '⭐' : '☆'}</button>` : ''}
      <div class="char-top">
        <div class="char-emoji">${charImg(c.name, 40) || c.emoji || '🎪'}</div>
        <div class="char-info">
          <div class="char-name">${esc(c.name)}</div>
          <div class="char-type">${typeLabel} · ${collIcon(collLabel, 14)}${esc(collLabel)}</div>
        </div>
      </div>
      <div class="level-display">
        <span class="level-label">${c.welcomed ? 'LEVEL' : 'NOT WELCOMED'}</span>
        <span class="level-val">${c.welcomed ? level + ' / ' + MAX_CHAR_LEVEL : '—'}</span>
      </div>
      <div class="level-bar"><div class="level-bar-fill" style="width:${pct}%"></div></div>
      <div class="char-actions">
        ${actionBtn}
        <button class="btn-sm btn-minus" data-action="leveldown" data-id="${c.id}">−Lvl</button>
        ${c.welcomed ? `<button class="btn-sm btn-minus" style="font-size:10px;" data-action="remove" data-id="${c.id}">Unwelcome</button>` : ''}
      </div>
    </div>`;
    }).join('');
  }
}

// Single delegated listener on the grid container
const grid = getEl('char-grid');
if (grid) {
  grid.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'levelup') levelUp(id);
    if (action === 'leveldown') levelDown(id);
    if (action === 'welcome') welcomeChar(id);
    if (action === 'remove') removeChar(id);
  });
}


// Assign stable IDs to every quest
STORYLINE_ARCS.forEach(arc => {
  arc.quests.forEach((q, i) => { q.id = String(i); });
});


// ============ CAMPAIGN STATE HELPERS ============
let arcFilter = 'all';

function getArcQuestState(arcId, questId, questMap) {
  const key = arcId + '_' + questId;
  if (questMap) return questMap.get(key) ?? false;
  if (!state.quests) state.quests = [];
  const q = state.quests.find(x => x.id === key);
  return q ? q.done : false;
}

function buildQuestMap() {
  const map = new Map();
  (state.quests || []).forEach(q => map.set(q.id, q.done));
  return map;
}

function toggleArcQuest(arcId, questId) {
  if (!state.quests) state.quests = [];
  const key = arcId + '_' + questId;
  const q = state.quests.find(x => x.id === key);
  if (q) { q.done = !q.done; }
  else { state.quests.push({ id: key, done: true }); }
  saveState();

  // Fall back to full re-render if search/filter is active — visibility may have changed
  const search = (getEl('campaign-search')?.value || '').trim();
  if (search || arcFilter !== 'all') { renderQuests(); return; }

  const arc = STORYLINE_ARCS.find(a => a.id === arcId);
  if (!arc) { renderQuests(); return; }

  // Compute arc stats before and after the toggle
  const questMap = buildQuestMap();
  const d = arc.quests.filter(q => getArcQuestState(arc.id, q.id, questMap)).length;
  const t = arc.quests.length;
  const newStatus = d === t ? 'done' : d > 0 ? 'progress' : 'todo';

  // Reconstruct pre-toggle d to determine old status
  const wasDone = q ? !q.done : false; // q.done reflects the NEW state after toggle above
  const oldD = wasDone ? d - 1 : d + 1;
  const oldStatus = oldD === t ? 'done' : oldD > 0 ? 'progress' : 'todo';

  // If arc status changed, border/header colours need updating — full re-render
  if (newStatus !== oldStatus) { renderQuests(); return; }

  // --- In-place updates ---
  const arcPct = t > 0 ? Math.round(d / t * 100) : 0;
  const remaining = t - d;
  const statusColor = newStatus === 'done' ? 'var(--green)' : newStatus === 'progress' ? 'var(--gold)' : 'var(--muted)';
  const statusIcon = newStatus === 'done' ? '✓' : newStatus === 'progress' ? '◑' : '○';

  // 1. Toggle the quest item class and check mark
  const questEl = document.querySelector(`.quest-item[data-arc="${arcId}"][data-quest="${questId}"]`);
  if (questEl) {
    const isDone = getArcQuestState(arcId, questId, questMap);
    questEl.classList.toggle('done', isDone);
    const checkEl = questEl.querySelector('.quest-check');
    if (checkEl) checkEl.textContent = isDone ? '✓' : '';
  }

  // 2. Update arc header — count, pct, progress bar fill, remaining label
  const arcCard = document.querySelector(`#arc-body-${arcId}`)?.closest('.card');
  if (arcCard) {
    const countEl = arcCard.querySelector('[data-arc-count]');
    if (countEl) { countEl.textContent = `${statusIcon} ${d}/${t}`; countEl.style.color = statusColor; }

    const pctEl = arcCard.querySelector('[data-arc-pct]');
    if (pctEl) pctEl.textContent = arcPct + '%';

    const fillEl = arcCard.querySelector('[data-arc-fill]');
    if (fillEl) { fillEl.style.width = arcPct + '%'; fillEl.style.background = `linear-gradient(90deg,var(--teal),${statusColor})`; }

    const remEl = arcCard.querySelector('[data-arc-remaining]');
    if (remEl) {
      remEl.textContent = remaining > 0 ? `${remaining} quest${remaining > 1 ? 's' : ''} remaining` : '';
      remEl.style.display = (newStatus !== 'done' && remaining > 0) ? '' : 'none';
    }
  }

  // 3. Update top-level progress bar and act pills only
  renderQuestsHeader();
}

// Updates only the top progress bar and act pills — called from toggleArcQuest in-place path
function renderQuestsHeader() {
  const questMap = buildQuestMap();
  let totalQ = 0, doneQ = 0, totalSide = 0, doneSide = 0;
  STORYLINE_ARCS.forEach(arc => {
    arc.quests.forEach(q => {
      if (arc.side) { totalSide++; if (getArcQuestState(arc.id, q.id, questMap)) doneSide++; }
      else { totalQ++; if (getArcQuestState(arc.id, q.id, questMap)) doneQ++; }
    });
  });
  const pct = totalQ > 0 ? Math.round(doneQ / totalQ * 100) : 0;
  const story_pct_label = getEl('story-pct-label');
  if (story_pct_label) story_pct_label.textContent = `${doneQ} / ${totalQ} main quests (${pct}%) · ${doneSide}/${totalSide} side`;
  const story_prog_bar = getEl('story-prog-bar');
  if (story_prog_bar) story_prog_bar.style.width = pct + '%';

  const pillRow = getEl('arc-pill-row');
  if (!pillRow) return;
  const actNums = [...new Set(STORYLINE_ARCS.map(a => a.act))].sort((a, b) => a - b);
  pillRow.innerHTML = actNums.map(actNum => {
    const actArcs = STORYLINE_ARCS.filter(a => a.act === actNum);
    const aD = actArcs.reduce((s, a) => s + a.quests.filter(q => getArcQuestState(a.id, q.id, questMap)).length, 0);
    const aT = actArcs.reduce((s, a) => s + a.quests.length, 0);
    const aPct = aT > 0 ? Math.round(aD / aT * 100) : 0;
    const col = aPct === 100 ? 'var(--green)' : aPct > 0 ? 'var(--gold)' : 'var(--muted)';
    const bg = aPct === 100 ? 'rgba(57,232,124,0.12)' : aPct > 0 ? 'rgba(245,200,66,0.1)' : 'rgba(255,255,255,0.05)';
    const landNames = { 1: 'Toontown', 2: 'Tomorrowland', 3: 'Fantasyland', 4: 'Frontierland', 5: 'Adventureland' };
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:${bg};color:${col}">Act ${actNum} ${landNames[actNum] || ''}: ${aD}/${aT}</span>`;
  }).join('');
}

function filterArcs(f, btn) {
  arcFilter = f;
  document.querySelectorAll('#tab-campaign .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderQuests();
}

function expandAllArcs() {
  document.querySelectorAll('[id^="arc-body-"]').forEach(el => el.style.display = '');
}

function collapseAllArcs() {
  document.querySelectorAll('[id^="arc-body-"]').forEach(el => el.style.display = 'none');
}

function renderQuests() {
  renderQuestsHeader();

  const questMap = buildQuestMap();
  const arcStats = STORYLINE_ARCS.map(arc => {
    const d = arc.quests.filter(q => getArcQuestState(arc.id, q.id, questMap)).length;
    const t = arc.quests.length;
    const status = d === t ? 'done' : d > 0 ? 'progress' : 'todo';
    return { arc, d, t, status };
  });

  const search = (getEl('campaign-search')?.value || '').trim().toLowerCase();

  let arcs = arcStats;
  if (arcFilter === 'done') arcs = arcs.filter(x => x.status === 'done');
  if (arcFilter === 'inprogress') arcs = arcs.filter(x => x.status === 'progress');
  if (arcFilter === 'todo') arcs = arcs.filter(x => x.status === 'todo');
  if (arcFilter === 'main') arcs = arcs.filter(x => !x.arc.side);
  if (arcFilter === 'side') arcs = arcs.filter(x => !!x.arc.side);

  if (search) {
    arcs = arcs.filter(({ arc }) =>
      arc.title.toLowerCase().includes(search) ||
      arc.quests.some(q =>
        q.name.toLowerCase().includes(search) ||
        (q.chars || []).some(c => c.toLowerCase().includes(search))
      )
    );
  }

  const container = getEl('arc-list');
  if (!container) return;

  if (!arcs.length) {
    container.innerHTML = '<div class="empty-state"><div class="es-icon">📖</div><p>No arcs match this filter.</p></div>';
    return;
  }

  const firstActive = arcs.find(x => x.status === 'progress') || arcs.find(x => x.status === 'todo');

  {
    container.innerHTML = arcs.map(({ arc, d, t, status }) => {
      const arcPct = t > 0 ? Math.round(d / t * 100) : 0;
      const statusColor = status === 'done' ? 'var(--green)' : status === 'progress' ? 'var(--gold)' : 'var(--muted)';
      const statusIcon = status === 'done' ? '✓' : status === 'progress' ? '◑' : '○';
      const isSide = !!arc.side;
      const headerBg = isSide
        ? (status === 'done' ? 'rgba(57,232,124,0.10)' : status === 'progress' ? 'rgba(87,210,255,0.10)' : 'rgba(87,210,255,0.04)')
        : (status === 'done' ? 'rgba(57,232,124,0.08)' : status === 'progress' ? 'rgba(245,200,66,0.07)' : 'rgba(255,255,255,0.03)');

      const existingBody = getEl('arc-body-' + arc.id);
      const isOpen = search
        ? true                                                        // always open when searching
        : existingBody
          ? existingBody.style.display !== 'none'                    // preserve current state if already rendered
          : (status === 'progress' || arc === firstActive?.arc);     // initial open logic on first render
      const remaining = t - d;

      const questsHtml = arc.quests.map(q => {
        const done = getArcQuestState(arc.id, q.id, questMap);
        const matchesSearch = search && (
          q.name.toLowerCase().includes(search) ||
          (q.chars || []).some(c => c.toLowerCase().includes(search))
        );
        const charsHtml = q.chars && q.chars.length
          ? q.chars.map(c => {
            const charMatches = search && c.toLowerCase().includes(search);
            return `<span style="font-size:10px;background:${charMatches ? 'rgba(245,200,66,0.25)' : 'rgba(255,255,255,0.07)'};
                padding:1px 6px;border-radius:6px;margin-right:3px;
                ${charMatches ? 'color:var(--gold);font-weight:700;' : ''}">${c}</span>`;
          }).join('')
          : '';
        return `
          <div class="quest-item ${done ? 'done' : ''}"
            data-arc="${arc.id}" data-quest="${q.id}"
            style="cursor:pointer;user-select:none;${matchesSearch ? 'background:rgba(245,200,66,0.05);border-radius:8px;' : ''}">
            <div class="quest-check">${done ? '✓' : ''}</div>
            <div class="quest-content" style="flex:1;min-width:0;">
              <div class="quest-name">${esc(q.name)}</div>
              ${charsHtml ? `<div style="margin-top:4px;">${charsHtml}</div>` : ''}
              ${q.tip ? `<div style="font-size:10px;color:var(--teal);margin-top:3px;">💡 ${esc(q.tip)}</div>` : ''}
            </div>
          </div>`;
      }).join('');

      return `
      <div class="card" style="margin-bottom:10px;border-color:${statusColor}22;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;background:${headerBg};border-radius:10px;padding:10px 12px;cursor:pointer;" onclick="toggleArcCollapse('${arc.id}')">
          <span style="font-size:24px;">${arc.emoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:10px;font-weight:800;background:rgba(245,200,66,0.18);color:var(--gold);padding:1px 7px;border-radius:6px;">ACT ${arc.act}</span>
              ${isSide ? `<span style="font-size:10px;font-weight:800;background:rgba(87,210,255,0.18);color:var(--teal);padding:1px 7px;border-radius:6px;">SIDE</span>` : ''}
              <span style="font-weight:800;font-size:14px;">${collIcon(arc.collection || '', 18)}${esc(arc.title)}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(arc.desc)}</div>
            ${arc.unlock ? `<div style="font-size:10px;color:var(--teal);margin-top:2px;">🔓 Unlocks after: ${esc(arc.unlock)}</div>` : ''}
            ${status !== 'done' && remaining > 0 ? `<div data-arc-remaining style="font-size:10px;color:var(--muted);margin-top:2px;">${remaining} quest${remaining > 1 ? 's' : ''} remaining</div>` : `<div data-arc-remaining style="display:none;font-size:10px;color:var(--muted);margin-top:2px;"></div>`}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div data-arc-count style="font-size:12px;font-weight:800;color:${statusColor}">${statusIcon} ${d}/${t}</div>
            <div data-arc-pct style="font-size:10px;color:var(--muted);">${arcPct}%</div>
          </div>
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;margin-bottom:10px;">
          <div data-arc-fill style="height:100%;width:${arcPct}%;border-radius:10px;background:linear-gradient(90deg,var(--teal),${statusColor});transition:width 0.4s;"></div>
        </div>
        <div id="arc-body-${arc.id}" class="quest-list" style="${isOpen ? '' : 'display:none;'}">
          ${questsHtml}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.quest-item[data-arc]').forEach(el => {
      el.addEventListener('click', () => {
        toggleArcQuest(el.dataset.arc, el.dataset.quest);
      });
    });
  }
}

function toggleArcCollapse(arcId) {
  const body = getEl('arc-body-' + arcId);
  if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
}

// ============ DECORATIONS ============
let decFilter = 'all';
let decCatFilter = '';

function setDecFilter(f, btn) {
  decFilter = f;
  ['all', 'owned', 'missing'].forEach(k => {
    const b = getEl('dec-btn-' + k);
    if (b) b.classList.toggle('active', k === f);
  });
  renderDecorations();
}

function setDecCatFilter(f, btn) {
  decCatFilter = f;
  ['', 'Trophy', 'Greenery', 'Monument', 'Scenery', 'Amenity'].forEach(k => {
    const id = 'dec-cat-' + (k === '' ? 'all' : k.toLowerCase());
    const b = getEl(id);
    if (b) b.classList.toggle('active', k === f);
  });
  renderDecorations();
}

function initDecCollFilter() {
  const sel = getEl('dec-coll-filter');
  if (!sel || sel.options.length > 1) return;
  const colls = [...new Set(DMK_DECORATIONS.map(d => d.collection))].sort();
  colls.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function toggleDecOwned(name) {
  if (!state.decorations_owned) state.decorations_owned = {};
  state.decorations_owned[name] = !state.decorations_owned[name];
  saveState();
  renderDecorations();
}

function renderDecorations() {
  if (typeof DMK_DECORATIONS === 'undefined') return;
  initDecCollFilter();
  const grid = getEl('dec-grid');
  if (!grid) return;

  const search = (getEl('dec-search')?.value || '').toLowerCase();
  const coll = getEl('dec-coll-filter')?.value || '';
  const sort = getEl('dec-sort')?.value || 'name';

  let items = DMK_DECORATIONS.filter(d => {
    const owned = state.decorations_owned?.[d.name];
    if (decFilter === 'owned' && !owned) return false;
    if (decFilter === 'missing' && owned) return false;
    if (decCatFilter && d.category !== decCatFilter) return false;
    if (coll && d.collection !== coll) return false;
    if (search &&
      !d.name.toLowerCase().includes(search) &&
      !d.collection.toLowerCase().includes(search) &&
      !d.category.toLowerCase().includes(search)) return false;
    return true;
  });

  if (sort === 'collection') items.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
  else if (sort === 'category') items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  else if (sort === 'size') items.sort((a, b) => a.size.localeCompare(b.size) || a.name.localeCompare(b.name));
  else if (sort === 'elixir') items.sort((a, b) => (b.elixir || 0) - (a.elixir || 0) || a.name.localeCompare(b.name));
  else items.sort((a, b) => a.name.localeCompare(b.name));

  // Progress bar
  const totalAll = DMK_DECORATIONS.length;
  const ownedAll = DMK_DECORATIONS.filter(d => state.decorations_owned?.[d.name]).length;
  const pct = totalAll > 0 ? Math.round(ownedAll / totalAll * 100) : 0;
  const pctLabel = getEl('dec-pct-label');
  if (pctLabel) pctLabel.textContent = `${ownedAll} / ${totalAll} owned (${pct}%)`;
  const progBar = getEl('dec-prog-bar');
  if (progBar) progBar.style.width = pct + '%';

  const countEl = getEl('dec-count');
  if (countEl) countEl.textContent = items.length + ' decorations';

  const catEmoji = { Trophy: '🏆', Greenery: '🌿', Monument: '🗿', Scenery: '🏞️', Amenity: '🪑' };
  const catColor = { Trophy: 'var(--gold)', Greenery: '#34d399', Monument: '#9ca3af', Scenery: '#60a5fa', Amenity: '#f472b6' };
  const rarityColor = { Common: '#9ca3af', Uncommon: '#34d399', Rare: '#60a5fa', Epic: '#c084fc', Legendary: '#fbbf24' };

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🎀</div><p>No decorations match this filter.</p></div>`;
    return;
  }

  grid.innerHTML = items.map(d => {
    const owned = state.decorations_owned?.[d.name];
    const col = catColor[d.category] || 'var(--muted)';
    const rCol = rarityColor[d.rarity] || 'var(--muted)';
    const borderCol = owned ? 'var(--green)' : 'var(--border)';
    const bgStyle = owned ? 'background:rgba(57,232,124,0.04);' : '';

    return `<div style="background:var(--card);border:1px solid ${borderCol};${bgStyle}border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:26px;line-height:1;">${d.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:13px;line-height:1.3;">${esc(d.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${collIcon(d.collection, 14)}${esc(d.collection)}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">
            <span style="font-size:10px;font-weight:800;background:rgba(255,255,255,0.07);color:${col};padding:1px 7px;border-radius:6px;">${catEmoji[d.category] || ''} ${d.category}</span>
            <span style="font-size:10px;font-weight:800;background:rgba(255,255,255,0.07);color:${rCol};padding:1px 7px;border-radius:6px;">${d.rarity || ''}</span>
            ${owned ? `<span style="font-size:10px;font-weight:800;background:rgba(57,232,124,0.18);color:var(--green);padding:1px 7px;border-radius:6px;">✓ OWNED</span>` : ''}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
        <div style="background:var(--card2);border-radius:8px;padding:5px 8px;text-align:center;">
          <div style="color:var(--muted);">Size</div>
          <div style="font-weight:700;">${d.size}</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:5px 8px;text-align:center;">
          <div style="color:var(--muted);">⚗️ Elixir</div>
          <div style="font-weight:700;color:${rCol};">${d.elixir || '—'}</div>
        </div>
      </div>
      <button class="dec-card-btn" data-name="${esc(d.name)}"
      style="width:100%;padding:7px;border-radius:10px;border:none;cursor:pointer;font-size:12px;font-weight:700;
      background:${owned ? 'rgba(57,232,124,0.15)' : 'rgba(245,200,66,0.12)'};
      color:${owned ? 'var(--green)' : 'var(--gold)'};">
        ${owned ? '✓ Mark as Not Owned' : '＋ Mark as Owned'}
      </button>
    </div>`;
  }).join('');
}

// ============ DASHBOARD ============
function updateDashboard() {
  const chars = state.characters;
  const welcomed = chars.filter(c => c.welcomed).length;
  const maxed = chars.filter(c => c.level >= c.max && c.welcomed).length;
  // Count done quests across all arcs
  let questsDone = 0;
  if (STORYLINE_ARCS) {
    STORYLINE_ARCS.forEach(arc => {
      arc.quests.forEach(q => {
        if (getArcQuestState(arc.id, q.id)) questsDone++;
      });
    });
  }

  const stat_chars = getEl('stat-chars')
  if (stat_chars) stat_chars.textContent = welcomed + ' / ' + chars.length;
  const stat_maxed = getEl('stat-maxed');
  if (stat_maxed) stat_maxed.textContent = maxed;
  const totalArqQuests = STORYLINE_ARCS ? STORYLINE_ARCS.reduce((s, a) => s + a.quests.length, 0) : 0;

  const stat_quests = getEl('stat-quests');
  if (stat_quests) stat_quests.textContent = questsDone + '/' + totalArqQuests;

  if (state.attractions && state.attractions.length) {
    const attrBuilt = state.attractions.filter(a => a.built).length;
    const attrTotal = state.attractions.length;
    const attrEl = getEl('stat-attractions');
    if (attrEl) attrEl.textContent = attrBuilt + ' / ' + attrTotal;
    const attrBarEl = getEl('dash-attr-bar');
    const attrPctEl = getEl('dash-attr-pct');
    const attrPct = attrTotal > 0 ? Math.round(attrBuilt / attrTotal * 100) : 0;
    if (attrBarEl) attrBarEl.style.width = attrPct + '%';
    if (attrPctEl) attrPctEl.textContent = attrPct + '%';
  }

  // Costumes
  if (state.costumes && state.costumes.length) {
    const cosOwned = state.costumes.filter(c => c.owned).length;
    const cosTotal = state.costumes.length;
    const cosPct = cosTotal > 0 ? Math.round(cosOwned / cosTotal * 100) : 0;
    const cosBar = getEl('dash-cos-bar'); const cosPctEl = getEl('dash-cos-pct');
    if (cosBar) cosBar.style.width = cosPct + '%';
    if (cosPctEl) cosPctEl.textContent = cosOwned + ' / ' + cosTotal;
  }

  // Floats
  if (typeof DMK_FLOATS !== 'undefined') {
    const floatOwned = DMK_FLOATS.filter(f => state.floats_owned?.[f.name]).length;
    const floatTotal = DMK_FLOATS.length;
    const floatPct = floatTotal > 0 ? Math.round(floatOwned / floatTotal * 100) : 0;
    const floatBar = getEl('dash-float-bar'); const floatPctEl = getEl('dash-float-pct');
    if (floatBar) floatBar.style.width = floatPct + '%';
    if (floatPctEl) floatPctEl.textContent = floatOwned + ' / ' + floatTotal;
  }

  // Concessions
  if (typeof DMK_CONCESSIONS_DATA !== 'undefined') {
    const conOwned = DMK_CONCESSIONS_DATA.filter(c => state.concessions_owned?.[c.name]).length;
    const conTotal = DMK_CONCESSIONS_DATA.length;
    const conPct = conTotal > 0 ? Math.round(conOwned / conTotal * 100) : 0;
    const conBar = getEl('dash-con-bar'); const conPctEl = getEl('dash-con-pct');
    if (conBar) conBar.style.width = conPct + '%';
    if (conPctEl) conPctEl.textContent = conOwned + ' / ' + conTotal;
  }

  // Decorations
  if (typeof DMK_DECORATIONS !== 'undefined') {
    const decOwned = DMK_DECORATIONS.filter(d => state.decorations_owned?.[d.name]).length;
    const decTotal = DMK_DECORATIONS.length;
    const decPct = decTotal > 0 ? Math.round(decOwned / decTotal * 100) : 0;
    const decBar = getEl('dash-dec-bar'); const decPctEl = getEl('dash-dec-pct');
    if (decBar) decBar.style.width = decPct + '%';
    if (decPctEl) decPctEl.textContent = decOwned + ' / ' + decTotal;
  }

  const storyPct = totalArqQuests > 0 ? Math.round(questsDone / totalArqQuests * 100) : 0;
  const charsPct = chars.length > 0 ? Math.round(welcomed / chars.length * 100) : 0;

  const dashStoryPct = getEl('dash-story-pct');
  if (dashStoryPct) dashStoryPct.textContent = storyPct + '%';
  const dashStoryBar = getEl('dash-story-bar');
  if (dashStoryBar) dashStoryBar.style.width = storyPct + '%';
  const dashCharsPct = getEl('dash-chars-pct');
  if (dashCharsPct) dashCharsPct.textContent = charsPct + '%';
  const dashCharsBar = getEl('dash-chars-bar');
  if (dashCharsBar) dashCharsBar.style.width = charsPct + '%';

  // Sync resource inputs
  const res_magic = getEl('res-magic');
  if (res_magic) res_magic.value = state.resources.magic || 0;
  const res_gems = getEl('res-gems');
  if (res_gems) res_gems.value = state.resources.gems || 0;
  const res_dreamsparks = getEl('res-dreamsparks');
  if (res_dreamsparks) res_dreamsparks.value = state.resources.dreamsparks || 0;

  // Focus list
  const focusItems = [];
  const missingDecorations = DMK_DECORATIONS
    ? DMK_DECORATIONS.filter(d => !state.decorations_owned?.[d.name])
    : [];
  if (missingDecorations.length > 0 && missingDecorations.length <= 20) {
    focusItems.push({ icon: '🎀', text: `<strong>${missingDecorations.length} decoration(s)</strong> almost complete — visit the Decorations tab to finish your collection.` });
  }
  const needsLevel = chars.filter(c => c.welcomed && parseInt(c.level) < MAX_CHAR_LEVEL);
  if (needsLevel.length) focusItems.push({ icon: '⬆️', text: `<strong>${needsLevel.length} character(s)</strong> can be leveled up. Prioritize characters blocking quest progress!` });
  const notWelcomed = chars.filter(c => !c.welcomed);
  const notWelcomedStory = notWelcomed.filter(c => c.type === 'storyline');
  if (notWelcomedStory.length) focusItems.push({ icon: '🏰', text: `<strong>${notWelcomedStory.length} storyline character(s)</strong> not yet welcomed (${notWelcomed.length} total). Tap a card to welcome them!` });
  // Find next pending arc quest
  let nextQuest = null, nextArc = null;
  outerLoop: for (const arc of (STORYLINE_ARCS || [])) {
    for (const q of arc.quests) {
      if (!getArcQuestState(arc.id, q.id)) { nextQuest = q; nextArc = arc; break outerLoop; }
    }
  }
  if (nextQuest) focusItems.push({ icon: '📖', text: `Next quest: <strong>${nextQuest.name}</strong> (${nextArc.title}) — needs: ${nextQuest.chars.join(', ')}` });

  const focusList = getEl('focus-list');
  if (!focusList) return;
  if (!focusItems.length) {
    focusList.innerHTML = '<div class="tip-item"><span class="tip-icon">🏆</span><div class="tip-text">Your kingdom is in great shape! Keep collecting and check back after adding more characters or quests.</div></div>';
  } else {
    focusList.innerHTML = focusItems.map(f => `<div class="tip-item"><span class="tip-icon">${f.icon}</span><div class="tip-text">${f.text}</div></div>`).join('');
  }
}

// ============ ATTRACTIONS ============
let attrFilter = 'all';

function loadAttractions() {
  if (!state.attractions) state.attractions = [];
  // Merge DB with saved state — preserve built and enchant_level
  const saved = {};
  state.attractions.forEach(a => { saved[a.id] = { built: a.built, enchant_level: a.enchant_level || 0 }; });
  state.attractions = DMK_ATTRACTIONS.map(a => ({
    ...a,
    built: saved[a.id]?.built || false,
    enchant_level: saved[a.id]?.enchant_level || 0
  }));
}

function loadCostumes() {
  if (!state.costumes) state.costumes = [];
  const savedOwned = {};
  state.costumes.forEach(c => {
    if (!c || !c.char || !c.costume) return; // guard against null/malformed entries
    const stableId = 'cos_' + c.char + '|' + c.costume;
    savedOwned[stableId] = c.owned;
  });
  state.costumes = DMK_COSTUMES.filter(c => c && c.char && c.costume).map(c => ({
    id: 'cos_' + c.char + '|' + c.costume,
    char: c.char, collection: c.collection, costume: c.costume,
    owned: savedOwned['cos_' + c.char + '|' + c.costume] || false
  }));
}

function toggleCostume(id) {
  const c = state.costumes.find(x => x.id === id);
  if (c) { c.owned = !c.owned; saveState(); renderCostumes(); }
}

let costumeFilter = 'all';
function setCostumeFilter(f, btn) {
  costumeFilter = f;
  document.querySelectorAll('#tab-costumes .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCostumes();
}

let _lastCostumeCollList = '';
function populateCostumeCollFilter() {
  const sel = getEl('costume-coll-filter');
  if (!sel) return;
  const cols = [...new Set(DMK_COSTUMES.map(c => c.collection))].sort();
  const key = cols.join('|');
  if (key === _lastCostumeCollList) return;
  _lastCostumeCollList = key;
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Collections</option>' +
    cols.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
}

function renderCostumes() {
  const list = getEl('costume-list');
  const prog = getEl('costume-progress');
  if (!list) return;
  if (!prog) return;

  populateCostumeCollFilter();

  const search = (getEl('costume-search')?.value || '').toLowerCase();
  const collFilter = getEl('costume-coll-filter')?.value || '';

  let costumes = state.costumes;
  if (search) costumes = costumes.filter(c =>
    c.char.toLowerCase().includes(search) ||
    c.costume.toLowerCase().includes(search) ||
    c.collection.toLowerCase().includes(search));
  if (collFilter) costumes = costumes.filter(c => c.collection === collFilter);
  if (costumeFilter === 'owned') costumes = costumes.filter(c => c.owned);
  if (costumeFilter === 'missing') costumes = costumes.filter(c => !c.owned);

  const total = state.costumes.length;
  const owned = state.costumes.filter(c => c.owned).length;
  const pct = total > 0 ? Math.round(owned / total * 100) : 0;
  prog.innerHTML = `<span style="color:var(--gold);font-weight:700;">${owned}/${total}</span> costumes owned &nbsp;
    <span style="color:var(--green);">${pct}%</span>
    <div style="height:4px;background:var(--border);border-radius:4px;margin-top:4px;max-width:300px;">
      <div style="height:4px;background:var(--gold);border-radius:4px;width:${pct}%;transition:width 0.3s;"></div>
    </div>`;

  if (!costumes.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">👗</div><p>No costumes match this filter.</p></div>`;
    return;
  }

  // Group by collection then by character
  const byCollection = {};
  costumes.forEach(c => {
    if (!byCollection[c.collection]) byCollection[c.collection] = {};
    if (!byCollection[c.collection][c.char]) byCollection[c.collection][c.char] = [];
    byCollection[c.collection][c.char].push(c);
  });

  list.innerHTML = Object.keys(byCollection).sort().map(col => {
    const chars = byCollection[col];
    const colTotal = Object.values(chars).flat().length;
    const colOwned = Object.values(chars).flat().filter(c => c.owned).length;
    return `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:1.5px;text-transform:uppercase;
          padding:6px 10px;background:var(--card2);border-radius:8px;margin-bottom:8px;
          display:flex;justify-content:space-between;align-items:center;">
          <span>${collIcon(col, 22)}${esc(col)}</span>
          <span style="color:var(--muted);font-size:10px;">${colOwned}/${colTotal}</span>
        </div>
        ${Object.keys(chars).sort().map(char => {
      const charCostumes = chars[char];
      return `
            <div style="margin-left:8px;margin-bottom:10px;">
              <div style="font-size:12px;color:var(--text);font-weight:700;margin-bottom:5px;opacity:0.85;">${esc(char)}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${charCostumes.map(c => `
                  <button onclick="toggleCostume('${c.id}')"
                    style="padding:5px 12px;border-radius:20px;border:1px solid ${c.owned ? 'var(--green)' : 'var(--border)'};
                      background:${c.owned ? 'rgba(57,232,124,0.12)' : 'var(--card2)'};
                      color:${c.owned ? 'var(--green)' : 'var(--muted)'};
                      font-size:11px;font-weight:700;cursor:pointer;font-family:'Nunito',sans-serif;
                      transition:all 0.15s;">
                    ${c.owned ? '✅' : '○'} ${c.costume}
                  </button>`).join('')}
              </div>
            </div>`;
    }).join('')}
      </div>`;
  }).join('');
}

function toggleAttr(id) {
  const a = state.attractions.find(x => x.id === id);
  if (!a) return;
  a.built = !a.built;
  saveState();
  renderAttractions();
  updateDashboard();
}

function setAttrFilter(f, btn) {
  attrFilter = f;
  document.querySelectorAll('#tab-attractions .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAttractions();
}

let _lastAttrCollList = '';
function populateAttrCollFilter() {
  const sel = getEl('attr-collection-filter');
  if (!sel) return;
  const cols = [...new Set(DMK_ATTRACTIONS.map(a => a.collection))].sort();
  const key = cols.join('|');
  if (key === _lastAttrCollList) return;
  _lastAttrCollList = key;
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Collections</option>' +
    cols.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
}

function renderAttractions() {
  const grid = getEl('attr-grid');
  const search = (getEl('attr-search-input')?.value || '').toLowerCase();
  const coll = getEl('attr-collection-filter')?.value || '';
  populateAttrCollFilter();

  const total = state.attractions.length;
  const built = state.attractions.filter(a => a.built).length;
  const pct = total > 0 ? Math.round(built / total * 100) : 0;
  const pctLabel = getEl('attr-pct-label');
  if (pctLabel) pctLabel.textContent = `${built} / ${total} built (${pct}%)`;

  const progBar = getEl('attr-prog-bar');
  if (progBar) progBar.style.width = pct + '%';

  let list = state.attractions;
  if (search) list = list.filter(a => a.name.toLowerCase().includes(search) || a.collection.toLowerCase().includes(search));
  if (coll) list = list.filter(a => a.collection === coll);
  if (attrFilter === 'built') list = list.filter(a => a.built);
  if (attrFilter === 'not-built') list = list.filter(a => !a.built);
  if (attrFilter === 'regular') list = list.filter(a => !a.elixir);
  if (attrFilter === 'elixir') list = list.filter(a => a.elixir);

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🏰</div><p>No attractions match this filter.</p></div>`;
    return;
  }

  if (grid) {
    grid.innerHTML = list.map(a => {
      const builtCls = a.built ? 'border-color:var(--green);' : '';
      const builtBg = a.built ? 'background:rgba(57,232,124,0.06);' : '';
      const elixirBadge = a.elixir
        ? `<span style="font-size:10px;font-weight:800;background:rgba(87,210,255,0.18);color:var(--teal);padding:1px 7px;border-radius:6px;">⚗️ ELIXIR</span>`
        : '';
      const builtBadge = a.built
        ? `<span style="font-size:10px;font-weight:800;background:rgba(57,232,124,0.18);color:var(--green);padding:1px 7px;border-radius:6px;">✓ BUILT</span>`
        : '';
      return `
    <div style="background:var(--card);border:1px solid var(--border);${builtBg}${builtCls}border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:26px;line-height:1;">${a.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:13px;line-height:1.3;">${esc(a.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${collIcon(a.collection, 14)}${esc(a.collection)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;">
            ${elixirBadge}${builtBadge}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;">
        <div style="background:var(--card2);border-radius:8px;padding:5px 8px;text-align:center;">
          <div style="color:var(--muted);">Size</div>
          <div style="font-weight:700;">${a.size}</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:5px 8px;text-align:center;">
          <div style="color:var(--muted);">Collect</div>
          <div style="font-weight:700;">${a.rewardTime}</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:5px 8px;text-align:center;">
          <div style="color:var(--muted);">✨ Magic</div>
          <div style="font-weight:700;">${a.rewardMagic}</div>
        </div>
      </div>
      <button onclick="toggleAttr('${a.id}')"
        style="width:100%;padding:7px;border-radius:10px;border:none;cursor:pointer;font-size:12px;font-weight:700;
        background:${a.built ? 'rgba(57,232,124,0.15)' : 'rgba(245,200,66,0.12)'};
        color:${a.built ? 'var(--green)' : 'var(--gold)'};">
        ${a.built ? '✓ Mark as Not Built' : '＋ Mark as Built'}
      </button>
      ${(() => {
          const enc = DMK_ENCHANTMENTS ? DMK_ENCHANTMENTS.find(e => e.name === a.name) : null;
          if (!enc) return '';
          const lvlColors = ['', '#9ca3af', '#34d399', '#60a5fa', '#c084fc', '#fbbf24'];
          const baseChip = enc.base_token
            ? `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--card2);border-radius:6px;padding:2px 6px;font-size:10px;">
              <span style="color:#f59e0b;font-weight:700;">Base</span>
              <span>${enc.base_token}</span>
            </span>` : '';
          const tokens = baseChip + enc.levels.filter(l => l.token).map(l => {
            const isDouble = l.token === 'Two Drop Chances';
            return `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--card2);border-radius:6px;padding:2px 6px;font-size:10px;">
            <span style="color:${lvlColors[l.level]};font-weight:700;">L${l.level}</span>
            <span style="${isDouble ? 'color:var(--gold);font-weight:700;' : ''}">${isDouble ? '✦ 2x Drop' : l.token}</span>
          </span>`;
          }).join('');
          return `<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;">⚡ ENCHANTMENT TOKENS <span style="opacity:0.6;">(${enc.timing})</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">${tokens}</div>
        </div>`;
        })()}
    </div>`;
    }).join('');
  }
}

// ============ INIT ============
loadState();
loadAttractions();
loadCostumes();
if (!state.decorations_owned) state.decorations_owned = {};
if (!state.concessions_owned) state.concessions_owned = {};

const _page = document.body.dataset.page;
if (_page === 'dashboard') { updateDashboard(); }
if (_page === 'characters') {
  populateCollFilter(); renderChars();
  initSearchClear('char-search-input', renderChars);
}
if (_page === 'attractions') {
  renderAttractions();
  initSearchClear('attr-search-input', renderAttractions);
}
if (_page === 'costumes') {
  renderCostumes();
  initSearchClear('costume-search', renderCostumes);
}
if (_page === 'tokens') {
  renderTokens();
  initSearchClear('tok-search', renderTokens);
}
if (_page === 'floats') {
  renderFloats();
  initSearchClear('float-search', renderFloats);
}
if (_page === 'concessions') {
  initConcessionCollFilter(); renderConcessions();
  initSearchClear('con-search', renderConcessions);
}
if (_page === 'enchantments') {
  initEncCollFilter(); renderEnchantmentsTab();
  initSearchClear('enc-search', renderEnchantmentsTab);
}
if (_page === 'campaign') {
  renderQuests();
  initSearchClear('campaign-search', renderQuests);
}
if (_page === 'decorations') {
  initDecCollFilter(); renderDecorations();
  initSearchClear('dec-search', renderDecorations);
}


// ============ EXPORT / IMPORT STATE ============
function exportState() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dmk-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
  showToast('✅ Backup exported successfully!');
}

function importState() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object')
          throw new Error('File is not a valid JSON object');
        if (!Array.isArray(parsed.characters) || parsed.characters.length === 0)
          throw new Error('Missing or empty characters list');
        if (!parsed.resources || typeof parsed.resources !== 'object')
          throw new Error('Missing resources data');
        localStorage.setItem('dmk-tracker-v2', JSON.stringify(parsed));
        showToast('✅ Backup imported successfully!');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast('❌ Import failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}


function filterConOwned(f) {
  conOwnerFilter = f;
  ['all', 'owned', 'missing'].forEach(k => {
    const btn = getEl('con-btn-' + k);
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderConcessions();
}

function initConcessionCollFilter() {
  const sel = getEl('con-coll-filter');
  if (!sel || sel.options.length > 1) return;
  const colls = [...new Set(DMK_CONCESSIONS_DATA.map(c => c.collection))].sort();
  colls.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function renderConcessions() {
  const grid = getEl('con-grid');
  if (!grid) return;
  const search = (getEl('con-search')?.value || '').toLowerCase();
  const cat = getEl('con-cat-filter')?.value || '';
  const coll = getEl('con-coll-filter')?.value || '';
  const sort = getEl('con-sort')?.value || 'name';

  let items = DMK_CONCESSIONS_DATA.filter(c => {
    if (search && !c.name.toLowerCase().includes(search) && !c.collection.toLowerCase().includes(search)) return false;
    if (cat && c.category !== cat) return false;
    if (coll && c.collection !== coll) return false;
    const owned = state.concessions_owned && state.concessions_owned[c.name];
    if (conOwnerFilter === 'owned' && !owned) return false;
    if (conOwnerFilter === 'missing' && owned) return false;
    return true;
  });

  if (sort === 'magic_per_hour') items.sort((a, b) => parseFloat(b.magic_per_hour || 0) - parseFloat(a.magic_per_hour || 0));
  else if (sort === 'collection') items.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
  else items.sort((a, b) => a.name.localeCompare(b.name));

  const con_count = getEl('con-count');
  if (con_count) con_count.textContent = items.length + ' concessions';

  const catIcon = { 'Food Stand': '🍔', 'Drink Stand': '🥤', 'Headwear Stand': '🎩', 'Souvenir Stand': '🎁' };

  const cardHtml = (c) => {
    const owned = state.concessions_owned && state.concessions_owned[c.name];
    const mphNum = parseFloat(c.magic_per_hour || 0);
    const mphColor = mphNum >= 11 ? 'var(--gold)' : mphNum >= 9 ? 'var(--accent)' : 'var(--muted)';
    return `<div class="card con-card" data-name="${esc(c.name)}" style="padding:12px;cursor:pointer;border:1px solid ${owned ? 'var(--accent)' : 'var(--border)'};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;line-height:1.3;">${owned ? '✅' : '○'} ${c.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${catIcon[c.category] || '📦'} ${c.category}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:13px;font-weight:700;color:${mphColor};">✨${c.magic_per_hour}/hr</div>
          <div class="text-xs text-muted">⏱ ${c.time}</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted);">
        <span>💰 Cost: ${c.exchange_rate}</span>
        <span>🧪 Elixir: ${c.elixir}</span>
        <span>⭐ XP: ${c.xp}</span>
        <span>✨ Magic: ${c.magic}</span>
      </div>
    </div>`;
  };

  if (sort === 'collection') {
    // Grouped view — collection headers with owned/total counts
    const byCollection = {};
    items.forEach(c => {
      if (!byCollection[c.collection]) byCollection[c.collection] = [];
      byCollection[c.collection].push(c);
    });
    grid.innerHTML = Object.keys(byCollection).sort().map(col => {
      const colItems = byCollection[col];
      const colOwned = colItems.filter(c => state.concessions_owned?.[c.name]).length;
      return `<div style="margin-bottom:16px;grid-column:1/-1;">
        <div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:1.5px;text-transform:uppercase;
          padding:6px 10px;background:var(--card2);border-radius:8px;margin-bottom:8px;
          display:flex;justify-content:space-between;align-items:center;">
          <span>${collIcon(col, 20)}${col}</span>
          <span style="color:var(--muted);font-size:10px;">${colOwned}/${colItems.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">
          ${colItems.map(cardHtml).join('')}
        </div>
      </div>`;
    }).join('');
  } else {
    grid.innerHTML = items.map(cardHtml).join('');
  }
}

function toggleConcession(name) {
  if (!state.concessions_owned) state.concessions_owned = {};
  state.concessions_owned[name] = !state.concessions_owned[name];
  saveState();
  renderConcessions();
}

// Delegated click handler for decoration toggle buttons
document.addEventListener('click', e => {
  const btn = e.target.closest('.dec-card-btn');
  if (btn) toggleDecOwned(btn.dataset.name);
});


// ============ ENCHANTMENTS TAB ============


function setEnchantLevel(id, level) {
  const a = state.attractions.find(x => x.id === id);
  if (!a || !a.built) return; // must be built first
  a.enchant_level = level;
  saveState();
  renderEnchantmentsTab();
  updateDashboard();
}

function filterEncBuilt(f) {
  encBuiltFilter = f;
  ['all', 'built', 'notbuilt'].forEach(k => {
    const btn = getEl('enc-btn-' + k);
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderEnchantmentsTab();
}

function initEncCollFilter() {
  const sel = getEl('enc-coll-filter');
  if (!sel || sel.options.length > 1) return;
  const colls = [...new Set(DMK_ENCHANTMENTS.map(e => e.collection))].sort();
  colls.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
}

function renderEnchantmentsTab() {
  const list = getEl('enc-list');
  if (!list) return;
  const search = (getEl('enc-search')?.value || '').toLowerCase();
  const coll = getEl('enc-coll-filter')?.value || '';
  const sort = getEl('enc-sort')?.value || 'name';
  const builtNames = (state.attractions || []).filter(a => a.built).map(a => a.name);

  let items = DMK_ENCHANTMENTS.filter(e => {
    const isBuilt = builtNames.includes(e.name);
    if (encBuiltFilter === 'built' && !isBuilt) return false;
    if (encBuiltFilter === 'notbuilt' && isBuilt) return false;
    if (coll && e.collection !== coll) return false;
    if (search) {
      const tokenNames = e.levels.map(l => (l.token || '').toLowerCase()).join(' ');
      if (!e.name.toLowerCase().includes(search) && !tokenNames.includes(search) && !e.collection.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  if (sort === 'collection') items.sort((a, b) => {
    const builtDiff = (builtNames.includes(b.name) ? 1 : 0) - (builtNames.includes(a.name) ? 1 : 0);
    return builtDiff || a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name);
  });
  else if (sort === 'timing') items.sort((a, b) => {
    const builtDiff = (builtNames.includes(b.name) ? 1 : 0) - (builtNames.includes(a.name) ? 1 : 0);
    return builtDiff || a.timing.localeCompare(b.timing) || a.name.localeCompare(b.name);
  });
  else items.sort((a, b) => {
    const builtDiff = (builtNames.includes(b.name) ? 1 : 0) - (builtNames.includes(a.name) ? 1 : 0);
    return builtDiff || a.name.localeCompare(b.name);
  });

  const encCount = getEl('enc-count');
  if (encCount) encCount.textContent = items.length + ' attractions';
  const lvlColors = ['', '#9ca3af', '#34d399', '#60a5fa', '#c084fc', '#fbbf24'];
  const timingColor = t => (!t ? 'var(--muted)' : (t.includes('60m') || t.includes('1h') || t.includes('2h')) ? '#34d399' : (t.includes('4h') || t.includes('6h')) ? '#60a5fa' : 'var(--muted)');

  list.innerHTML = items.map(e => {
    const isBuilt = builtNames.includes(e.name);
    const attrState = state.attractions?.find(a => a.name === e.name);
    const enchLevel = attrState?.enchant_level || 0;
    const maxLevel = ENCHANT_COSTS.length;
    const isMaxed = enchLevel >= maxLevel;

    // Token drops table
    const baseHtml = e.base_token
      ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:10px;font-weight:700;color:#f59e0b;min-width:20px;">Base</span>
          <span style="font-size:12px;flex:1;">${e.base_token} Token</span>
          <span style="font-size:10px;color:var(--muted);">always drops</span>
        </div>` : '';
    const levelsHtml = baseHtml + e.levels.map(l => {
      if (!l.token) return '';
      const isDouble = l.token === 'Two Drop Chances';
      const isUnlocked = enchLevel >= l.level;
      return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border);opacity:${isUnlocked ? '1' : '0.35'};">
        <span style="font-size:10px;font-weight:700;color:${lvlColors[l.level]};min-width:20px;">L${l.level}</span>
        <span style="font-size:12px;flex:1;${isDouble ? 'color:var(--gold);font-weight:700;' : ''}">${isDouble ? '✦ Two Drop Chances' : l.token + ' Token'}</span>
        <span style="font-size:10px;color:var(--muted);">+${l.cost} <span style="opacity:0.6;">(${l.total} total)</span></span>
        ${isUnlocked ? '<span style="font-size:10px;color:var(--green);">✓</span>' : ''}
      </div>`;
    }).join('');

    // Enchant level tracker
    const dotRow = Array.from({ length: maxLevel }, (_, i) => {
      const lvl = i + 1;
      const done = enchLevel >= lvl;
      const col = BLUEPRINT_COLOR[ENCHANT_COSTS[i].blueprint];
      if (!isBuilt) {
        return `<span style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
          font-size:9px;font-weight:800;border:2px solid var(--border);
          background:transparent;color:var(--border);cursor:not-allowed;opacity:0.4;"
          title="Build this attraction first">${lvl}</span>`;
      }
      return `<span style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
        font-size:9px;font-weight:800;cursor:pointer;border:2px solid ${col};
        background:${done ? col : 'transparent'};color:${done ? '#fff' : col};"
        onclick="setEnchantLevel('${attrState?.id}', ${done && enchLevel === lvl ? lvl - 1 : lvl})"
        title="Level ${lvl}: ${ENCHANT_COSTS[i].blueprint} Blueprint">${lvl}</span>`;
    }).join('');

    // Next level cost panel — only show for built attractions
    const nextCost = isBuilt && !isMaxed ? ENCHANT_COSTS[enchLevel] : null;
    const nextCostHtml = !isBuilt
      ? `<div style="margin-top:8px;padding:6px 10px;background:var(--card2);border-radius:8px;font-size:11px;color:var(--muted);">Build this attraction to start enchanting.</div>`
      : nextCost ? `
      <div style="margin-top:8px;padding:8px 10px;background:var(--card2);border-radius:8px;font-size:11px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:0.05em;margin-bottom:5px;">NEXT: LEVEL ${enchLevel + 1}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          <span style="background:var(--card);border-radius:6px;padding:2px 8px;">
            🔵 10 <span style="color:${BLUEPRINT_COLOR[nextCost.blueprint]};font-weight:700;">${nextCost.blueprint}</span> Blueprints
          </span>
          <span style="background:var(--card);border-radius:6px;padding:2px 8px;">
            🔶 ${nextCost.relics.toLocaleString()} ${e.relic || e.collection} Relics
          </span>
          <span style="background:var(--card);border-radius:6px;padding:2px 8px;">
            ✨ ${nextCost.magic.toLocaleString()} Magic
          </span>
          <span style="background:var(--card);border-radius:6px;padding:2px 8px;">
            ⏱ ${nextCost.time}
          </span>
        </div>
      </div>` : `<div style="margin-top:8px;padding:6px 10px;background:rgba(57,232,124,0.08);border-radius:8px;font-size:11px;color:var(--green);font-weight:700;">⭐ Fully Enchanted</div>`;

    return `<div class="card" style="padding:12px 14px;border-color:${isBuilt ? (enchLevel > 0 ? 'var(--green)' : 'var(--accent)') : 'var(--border)'};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:700;">${isBuilt ? '✅' : '○'} ${esc(e.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${collIcon(e.collection, 13)} ${esc(e.collection)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:12px;font-weight:700;color:${timingColor(e.timing)};">⏱ ${e.timing}</div>
          <div class="text-xs text-muted">Base: ${e.base_cost} elixir</div>
        </div>
      </div>

      <!-- Enchant level tracker -->
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:8px;">
        <span style="font-size:10px;font-weight:700;color:var(--muted);flex-shrink:0;">ENCHANT</span>
        <div style="display:flex;gap:4px;">${dotRow}</div>
        <span style="font-size:11px;color:${isMaxed ? 'var(--green)' : 'var(--muted)'};margin-left:auto;">${isMaxed ? '⭐ MAX' : enchLevel + '/' + maxLevel}</span>
      </div>

      ${nextCostHtml}

      <!-- Token drops -->
      <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:8px;">${levelsHtml}</div>
    </div>`;
  }).join('');
}


// ============ TOKEN TRACKER ============


function filterTokens(f) {
  tokFilter = f;
  ['all', 'ready', 'missing', 'maxed', 'wishlist'].forEach(k => {
    const btn = getEl('tok-btn-' + k);
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderTokens();
}

function getNeededQty(charName, currentLevel) {
  const td = DMK_CHAR_TOKENS[charName];
  if (!td) return null;
  const nextLvl = td.levels.find(l => l.level === currentLevel + 1);
  if (!nextLvl) return null; // already max or no data
  return { tokens: td.tokens, quantities: nextLvl.quantities, nextLevel: currentLevel + 1 };
}

function renderTokens() {
  const list = getEl('tok-list');
  if (!list) return;
  const search = (getEl('tok-search')?.value || '').toLowerCase();
  const sort = getEl('tok-sort')?.value || 'name';

  // Welcomed characters always shown; wishlisted unwelcomed chars also included
  let chars;
  if (tokFilter === 'wishlist') {
    chars = state.characters.filter(c => !c.welcomed && state.wishlist?.[c.id]);
  } else {
    chars = state.characters.filter(c => (c.welcomed && c.level < c.max) || state.wishlist?.[c.id]);
  }

  if (search) chars = chars.filter(c => {
    const td = DMK_CHAR_TOKENS[c.name];
    const tokenNames = td ? td.tokens.join(' ').toLowerCase() : '';
    return c.name.toLowerCase().includes(search) || tokenNames.includes(search);
  });

  // Compute readiness for each char
  const withStatus = chars.map(c => {
    const td = DMK_CHAR_TOKENS[c.name];
    const inv = state.token_inventory?.[c.name] || {};
    const maxed = c.level >= c.max;
    const noData = !td;
    let ready = false, pct = 0;

    if (!maxed && td) {
      const needed = getNeededQty(c.name, c.level);
      if (needed) {
        const tokensMet = needed.tokens.filter((t, i) => (inv[t] || 0) >= needed.quantities[i]).length;
        ready = tokensMet === needed.tokens.length;
        pct = needed.tokens.length > 0 ? Math.round(tokensMet / needed.tokens.length * 100) : 0;
      }
    }
    return { ...c, td, inv, maxed, noData, ready, pct };
  });

  // Filter
  let filtered = withStatus;
  if (tokFilter === 'ready') filtered = withStatus.filter(c => c.ready);
  if (tokFilter === 'missing') filtered = withStatus.filter(c => !c.ready && !c.maxed);
  if (tokFilter === 'maxed') filtered = withStatus.filter(c => c.maxed);

  // Sort
  if (sort === 'ready') filtered.sort((a, b) => (b.ready - a.ready) || a.name.localeCompare(b.name));
  else if (sort === 'progress') filtered.sort((a, b) => (b.pct - a.pct) || a.name.localeCompare(b.name));
  else filtered.sort((a, b) => a.name.localeCompare(b.name));

  const tokCount = getEl('tok-count');
  if (tokCount) tokCount.textContent = filtered.length + ' characters';

  // Summary: aggregate tokens needed across all non-maxed welcomed chars
  const summaryEl = getEl('tok-summary');
  if (summaryEl) {
    const allNonMaxed = state.characters.filter(c => c.welcomed && c.level < c.max);
    const totals = {};
    allNonMaxed.forEach(c => {
      const needed = getNeededQty(c.name, c.level);
      if (!needed) return;
      needed.tokens.forEach((t, i) => {
        const have = state.token_inventory?.[c.name]?.[t] || 0;
        const need = needed.quantities[i];
        const gap = Math.max(0, need - have);
        if (gap > 0) totals[t] = (totals[t] || 0) + gap;
      });
    });
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      summaryEl.innerHTML = `
        <div style="background:var(--card2);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:11px;">
          <div style="font-weight:700;color:var(--muted);font-size:10px;letter-spacing:0.05em;margin-bottom:6px;">TOKENS STILL NEEDED (all ${allNonMaxed.length} active characters)</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${entries.map(([t, n]) => `<span style="background:var(--card);border-radius:6px;padding:2px 8px;font-weight:700;">
              ${t} <span style="color:var(--red);">×${n}</span>
            </span>`).join('')}
          </div>
        </div>`;
    } else {
      summaryEl.innerHTML = '';
    }
  }

  list.innerHTML = filtered.map(c => {
    const needed = (!c.maxed && c.td) ? getNeededQty(c.name, c.level) : null;

    if (c.maxed) {
      return `<div class="card" style="padding:12px 14px;opacity:0.5;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${charImg(c.name, 36)}
          <div style="flex:1;">
            <div style="font-weight:700;font-size:13px;">${esc(c.name)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(c.collection)}</div>
          </div>
          <span style="font-size:11px;color:var(--gold);font-weight:700;">⭐ Max Level</span>
        </div>
      </div>`;
    }

    if (c.noData || !needed) {
      return `<div class="card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${charImg(c.name, 36)}
          <div style="flex:1;">
            <div style="font-weight:700;font-size:13px;">${esc(c.name)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(c.collection)}</div>
          </div>
          <span style="font-size:11px;color:var(--muted);">No data</span>
        </div>
      </div>`;
    }

    const allReady = needed.tokens.every((t, i) => (c.inv[t] || 0) >= needed.quantities[i]);
    const borderColor = allReady ? 'var(--green)' : 'var(--border)';

    const tokensHtml = needed.tokens.map((token, i) => {
      const have = c.inv[token] || 0;
      const need = needed.quantities[i];
      const enough = have >= need;
      const actSources = DMK_TOKEN_ACTIVITIES[token] || [];
      const enchSources = getTokenSources(token);
      const hasAny = actSources.length > 0 || enchSources.length > 0;
      const expandId = ('tok_' + c.name + '_' + token).replace(/[^a-zA-Z0-9]/g, '_');
      const actRows = actSources.map(s =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="font-size:10px;color:var(--muted);min-width:48px;flex-shrink:0;">${s.char_level}</span>
            <div style="min-width:0;overflow:hidden;">
              <span style="font-size:11px;font-weight:600;">${s.char}</span>
              <span style="font-size:10px;color:var(--muted);"> · ${s.activity}</span>
            </div>
          </div>
          <span style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:8px;">⏱ ${s.time}</span>
        </div>`
      ).join('');
      const enchRows = enchSources.slice(0, 3).map(s =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:10px;color:var(--gold);min-width:48px;flex-shrink:0;">⚡${s.enchant_level === 0 ? 'Base' : 'L' + s.enchant_level}</span>
            <span style="font-size:11px;font-weight:600;">${s.attraction}</span>
          </div>
          <span style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:8px;">⏱ ${s.timing}</span>
        </div>`
      ).join('');
      const rarity = (typeof TOKEN_RARITY !== 'undefined' && TOKEN_RARITY[token]) || 'unknown';
      return `<div style="background:var(--card2);border-radius:10px;padding:8px 10px;border:1px solid ${enough ? 'rgba(52,211,153,0.3)' : 'var(--border)'}" id="tokrow_${expandId}">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;">${token} Token <span class="rarity rarity-${rarity}">${rarity}</span></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <button class="tok-adj" data-char="${c.name.replace(/"/g, '&quot;')}" data-token="${token.replace(/"/g, '&quot;')}" data-delta="-1"
              style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
            <input id="tokcnt_${expandId}" type="number" min="0" data-char="${c.name.replace(/"/g, '&quot;')}" data-token="${token.replace(/"/g, '&quot;')}"
              value="${have}" style="width:48px;font-weight:800;font-size:14px;text-align:center;
              color:${enough ? 'var(--green)' : 'var(--red)'};
              background:var(--card);border:1px solid var(--border);
              border-radius:6px;padding:2px 4px;font-family:'Nunito',sans-serif;">
            <button class="tok-adj" data-char="${c.name.replace(/"/g, '&quot;')}" data-token="${token.replace(/"/g, '&quot;')}" data-delta="1"
              style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
            <span style="font-size:11px;color:var(--muted);min-width:40px;">/ ${need}</span>
            <span id="tokst_${expandId}" style="font-size:11px;">${enough ? '<span style="color:var(--green);font-size:12px;">✓</span>' : '<span style="color:var(--red);">-' + (need - have) + '</span>'}</span>
            ${hasAny ? `<button onclick="toggleTokExpand('${expandId}')" id="btn_${expandId}"
              style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">▼</button>` : ''}
          </div>
        </div>
        ${hasAny ? `<div id="${expandId}" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
          ${actRows ? '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:600;letter-spacing:0.05em;">CHARACTER ACTIVITIES</div>' + actRows : ''}
          ${enchRows ? '<div style="font-size:10px;color:var(--muted);margin:6px 0 4px;font-weight:600;letter-spacing:0.05em;">ENCHANTMENT DROPS</div>' + enchRows : ''}
        </div>` : ''}
      </div>`;
    }).join('');

    const isWishlistChar = !c.welcomed;
    const readyBadge = isWishlistChar
      ? `<span style="font-size:11px;color:var(--gold);font-weight:700;">🌟 Not welcomed</span>`
      : allReady
        ? `<span style="font-size:11px;color:var(--green);font-weight:700;">✅ Ready!</span>`
        : `<span style="font-size:11px;color:var(--muted);">Lv ${c.level} → ${needed.nextLevel}</span>`;

    return `<div class="card" style="padding:12px 14px;border-color:${borderColor};">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        ${charImg(c.name, 36)}
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13px;">${c.name}</div>
          <div style="font-size:11px;color:var(--muted);">${c.collection}</div>
        </div>
        ${readyBadge}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${tokensHtml}</div>
      ${allReady && !isWishlistChar ? `<button class="tok-levelup" data-char="${c.name.replace(/"/g, '&quot;')}" data-level="${needed.nextLevel}"
        style="margin-top:10px;width:100%;padding:8px;border-radius:10px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(52,211,153,0.15);color:var(--green);">
        ✨ Mark as Level ${needed.nextLevel}
      </button>` : ''}
    </div>`;
  }).join('');
}

function adjustToken(charName, token, delta) {
  if (!state.token_inventory) state.token_inventory = {};
  if (!state.token_inventory[charName]) state.token_inventory[charName] = {};
  state.token_inventory[charName][token] = Math.max(0, (state.token_inventory[charName][token] || 0) + delta);
  saveState();

  // Update in-place — find the row by its stable id
  const expandId = ('tok_' + charName + '_' + token).replace(/[^a-zA-Z0-9]/g, '_');
  const cntEl = getEl('tokcnt_' + expandId);
  const stEl = getEl('tokst_' + expandId);
  const rowEl = getEl('tokrow_' + expandId);
  if (!cntEl) { renderTokens(); return; } // row not rendered, fall back

  const have = state.token_inventory[charName][token];
  const td = DMK_CHAR_TOKENS[charName];
  const char = state.characters.find(c => c.name === charName);
  const needed = (td && char) ? getNeededQty(charName, char.level) : null;
  if (!needed) { renderTokens(); return; }

  const tIdx = needed.tokens.indexOf(token);
  const need = tIdx >= 0 ? needed.quantities[tIdx] : 0;
  const enough = have >= need;

  if (cntEl.tagName === 'INPUT') {
    cntEl.value = have;
  } else {
    cntEl.textContent = have;
  }
  cntEl.style.color = enough ? 'var(--green)' : 'var(--red)';
  stEl.innerHTML = enough
    ? '<span style="color:var(--green);font-size:12px;">✓</span>'
    : `<span style="color:var(--red);">-${need - have}</span>`;
  rowEl.style.borderColor = enough ? 'rgba(52,211,153,0.3)' : 'var(--border)';

  // Re-render the whole card only if ready-state changed (border + badge + level button)
  const allReady = needed.tokens.every((t, i) => (state.token_inventory?.[charName]?.[t] || 0) >= needed.quantities[i]);
  const wasReady = rowEl.closest('.card')?.querySelector('.tok-levelup') !== null;
  if (allReady !== wasReady) renderTokens();
}

function levelUpChar(charName, newLevel) {
  const char = state.characters.find(c => c.name === charName);
  if (!char) return;
  // Deduct tokens used
  const td = DMK_CHAR_TOKENS[charName];
  const needed = td?.levels.find(l => l.level === newLevel);
  if (needed && state.token_inventory?.[charName]) {
    td.tokens.forEach((t, i) => {
      if (state.token_inventory[charName][t]) {
        state.token_inventory[charName][t] = Math.max(0, (state.token_inventory[charName][t] || 0) - needed.quantities[i]);
      }
    });
  }
  char.level = newLevel;
  saveState();
  renderTokens();
  updateDashboard();
}


function toggleTokExpand(id) {
  const el = getEl(id);
  const btn = getEl('btn_' + id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '▼' : '▲';
}

// Delegated listeners — safe for any character/token name including apostrophes
document.addEventListener('click', e => {
  const adj = e.target.closest('.tok-adj');
  if (adj) { adjustToken(adj.dataset.char, adj.dataset.token, +adj.dataset.delta); return; }
  const lvl = e.target.closest('.tok-levelup');
  if (lvl) { levelUpChar(lvl.dataset.char, +lvl.dataset.level); return; }
  const ownBtn = e.target.closest('.float-own-btn');
  if (ownBtn) { toggleFloatOwned(ownBtn.dataset.name); return; }
  const activeBtn = e.target.closest('.float-active-btn');
  if (activeBtn) { toggleFloatActive(activeBtn.dataset.name); return; }
  const conCard = e.target.closest('.con-card');
  if (conCard) { toggleConcession(conCard.dataset.name); return; }
});

document.addEventListener('change', e => {
  const inp = e.target.closest('#tok-list input[type="number"][data-char]');
  if (!inp) return;
  const charName = inp.dataset.char;
  const token = inp.dataset.token;
  const newVal = Math.max(0, parseInt(inp.value) || 0);
  inp.value = newVal; // clamp display
  if (!state.token_inventory) state.token_inventory = {};
  if (!state.token_inventory[charName]) state.token_inventory[charName] = {};
  state.token_inventory[charName][token] = newVal;
  saveState();

  // Reuse adjustToken's in-place UI refresh by calling with delta 0 trick — 
  // instead just re-render to keep it simple and correct
  renderTokens();
});


// ============ FLOATS ============


function filterFloats(f) {
  floatFilter = f;
  ['all', 'owned', 'active', 'inactive', 'unowned'].forEach(k => {
    const btn = getEl('float-btn-' + k);
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderFloats();
}

function renderFloats() {
  const list = getEl('float-list');
  if (!list) return;
  const search = (getEl('float-search')?.value || '').toLowerCase();
  const sort = getEl('float-sort')?.value || 'name';

  let floats = DMK_FLOATS.map(f => ({
    ...f,
    owned: state.floats_owned?.[f.name] || false,
    active: state.floats_active?.[f.name] || false,
  }));

  if (search) floats = floats.filter(f =>
    f.name.toLowerCase().includes(search) || f.collection.toLowerCase().includes(search)
  );

  if (floatFilter === 'owned') floats = floats.filter(f => f.owned);
  if (floatFilter === 'active') floats = floats.filter(f => f.owned && f.active);
  if (floatFilter === 'inactive') floats = floats.filter(f => f.owned && !f.active);
  if (floatFilter === 'unowned') floats = floats.filter(f => !f.owned);

  if (sort === 'magic') floats.sort((a, b) => parseInt(b.magic_reward.replace(/,/g, '')) - parseInt(a.magic_reward.replace(/,/g, '')) || a.name.localeCompare(b.name));
  else if (sort === 'cost') floats.sort((a, b) => parseInt(a.cost.replace(/,/g, '')) - parseInt(b.cost.replace(/,/g, '')) || a.name.localeCompare(b.name));
  else floats.sort((a, b) => {
    // Sort: active first, then inactive owned, then unowned
    const aScore = a.active ? 0 : a.owned ? 1 : 2;
    const bScore = b.active ? 0 : b.owned ? 1 : 2;
    return aScore - bScore || a.name.localeCompare(b.name);
  });

  const floatCount = getEl('float-count');
  if (floatCount) floatCount.textContent = floats.length + ' floats';

  list.innerHTML = floats.map(f => {
    const floatToks = DMK_FLOAT_TOKENS[f.name] || [];
    const magicNum = parseInt(f.magic_reward.replace(/,/g, '') || '0');
    const magicColor = magicNum >= 1000 ? 'var(--gold)' : magicNum >= 500 ? 'var(--accent)' : 'var(--text)';
    const borderColor = f.active ? 'var(--green)' : f.owned ? 'var(--accent)' : 'var(--border)';
    const opacity = f.owned ? '1' : '0.45';
    const statusIcon = f.active ? '✅' : f.owned ? '⭕' : '🔒';
    const statusLabel = f.active ? 'Active' : f.owned ? 'Inactive' : 'Unowned';
    const statusColor = f.active ? 'var(--green)' : f.owned ? 'var(--muted)' : 'var(--muted)';

    return `<div class="card" style="padding:12px 14px;border-color:${borderColor};opacity:${opacity};">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;">🎡</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;">${esc(f.name)}</div>
          <div style="font-size:11px;color:var(--muted);">${esc(f.collection)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <button class="float-own-btn" data-name="${f.name.replace(/"/g, '&quot;')}"
  style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:${f.owned ? 'rgba(52,211,153,0.15)' : 'var(--card2)'};color:${f.owned ? 'var(--green)' : 'var(--muted)'};cursor:pointer;">
  ${f.owned ? '✓ Owned' : '+ Own'}
</button>
${f.owned ? `<button class="float-active-btn" data-name="${f.name.replace(/"/g, '&quot;')}"
  style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:${f.active ? 'rgba(52,211,153,0.15)' : 'var(--card2)'};color:${f.active ? 'var(--green)' : 'var(--muted)'};cursor:pointer;">
  ${statusIcon} ${statusLabel}
</button>` : `<span style="font-size:10px;color:var(--muted);">${statusIcon} ${statusLabel}</span>`}
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;background:var(--card2);border-radius:6px;padding:3px 8px;">⏱ ${f.time}</span>
        <span style="font-size:11px;background:var(--card2);border-radius:6px;padding:3px 8px;">💰 ${f.cost} assign</span>
        <span style="font-size:11px;background:var(--card2);border-radius:6px;padding:3px 8px;color:${magicColor};">✨ ${f.magic_reward} magic</span>
        <span style="font-size:11px;background:var(--card2);border-radius:6px;padding:3px 8px;color:var(--accent);">💎 ${f.gems} gems chance</span>
      </div>
      ${floatToks.length ? `<div style="margin-top:6px;">
        <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">🎟 POSSIBLE TOKENS</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${floatToks.map(t => `<span style="font-size:10px;background:var(--card2);border-radius:5px;padding:2px 6px;color:var(--text);">${t}</span>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

function toggleFloatOwned(name) {
  if (!state.floats_owned) state.floats_owned = {};
  state.floats_owned[name] = !state.floats_owned[name];
  if (!state.floats_owned[name]) {
    if (!state.floats_active) state.floats_active = {};
    state.floats_active[name] = false;
  }
  saveState();
  renderFloats();
}

function toggleFloatActive(name) {
  if (!state.floats_active) state.floats_active = {};
  state.floats_active[name] = !state.floats_active[name];
  saveState();
  renderFloats();
}

// Scroll active tab into view on load
const activeTab = document.querySelector('.tabs .tab.active');
if (activeTab) {
  activeTab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
}