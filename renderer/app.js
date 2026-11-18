'use strict';

const state = {
  connections: [],   // [{ id, name, path, tables }]
  activeId: null,
  tabs: [],          // [{ id, type, title, connId, table, sql, el }]
  activeTabId: null,
  tabSeq: 0,
};

const $ = (sel) => document.querySelector(sel);
let welcomeEl = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function connById(id) {
  return state.connections.find((c) => c.id === id) || null;
}
function activeConn() {
  return connById(state.activeId);
}
function formatValue(v) {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'null' };
  if (typeof v === 'number') return { text: String(v), cls: '' };
  if (v instanceof Uint8Array) {
    const bytes = Array.from(v);
    const hex = bytes.slice(0, 32).map((b) => b.toString(16).padStart(2, '0')).join('');
    const ascii = bytes.slice(0, 32).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    const more = bytes.length > 32 ? '…' : '';
    return { text: '0x' + hex + more + '  (' + ascii + more + ')', cls: 'blob' };
  }
  return { text: String(v), cls: '' };
}
function setStatus(left, right) {
  $('#status-left').textContent = left || '';
  $('#status-right').textContent = right || '';
}
function connSubtitle(conn) {
  if (!conn) return '';
  if (conn.type === 'mysql' || conn.type === 'postgres' || conn.type === 'mssql') return conn.host + ':' + conn.port + (conn.database ? '/' + conn.database : '');
  return conn.path || '';
}
function connIcon(conn) {
  if (!conn) return '🗄';
  if (conn.type === 'mysql') return conn.flavor === 'mariadb' ? '🦭' : '🐬';
  if (conn.type === 'postgres') return '🐘';
  if (conn.type === 'mssql') return '🏢';
  return '🗄';
}
function isRemote(conn) {
  return !!conn && (conn.type === 'mysql' || conn.type === 'postgres' || conn.type === 'mssql');
}

function promptModal(title, defaultVal) {
  return new Promise((resolve) => {
    $('#prompt-title').textContent = title;
    const input = $('#prompt-input');
    input.value = defaultVal || '';
    $('#prompt-modal').classList.remove('hidden');
    input.focus();
    input.select();
    const cleanup = () => { $('#prompt-modal').classList.add('hidden'); input.onkeydown = null; };
    $('#prompt-ok').onclick = () => { cleanup(); resolve(input.value); };
    $('#prompt-cancel').onclick = () => { cleanup(); resolve(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
    };
  });
}

function confirmModal(message) {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = message;
    $('#confirm-modal').classList.remove('hidden');
    const keyHandler = (e) => {
      if (e.key === 'Enter') { cleanup(); resolve(true); }
      else if (e.key === 'Escape') { cleanup(); resolve(false); }
    };
    const cleanup = () => { $('#confirm-modal').classList.add('hidden'); document.removeEventListener('keydown', keyHandler); };
    document.addEventListener('keydown', keyHandler);
    $('#confirm-ok').onclick = () => { cleanup(); resolve(true); };
    $('#confirm-cancel').onclick = () => { cleanup(); resolve(false); };
  });
}

/* ================= tabs ================= */

function makeTab(type, title, connId, extra) {
  const id = 'tab-' + (++state.tabSeq);
  const tab = { id, type, title, connId, ...extra };
  state.tabs.push(tab);

  // tab bar button
  const btn = el('div', 'tab');
  const label = el('span', 'label', title);
  const close = el('span', 'close', '×');
  close.title = '关闭';
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  btn.appendChild(label);
  btn.appendChild(close);
  btn.addEventListener('click', () => activateTab(id));
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showTabContextMenu(e, id); });
  tab.btn = btn;
  tab.label = label;

  // content pane
  const pane = el('div', 'tab-pane hidden');
  tab.el = pane;

  $('#tabbar').appendChild(btn);
  $('#tabcontent').appendChild(pane);
  return tab;
}

function refreshWelcome() {
  if (welcomeEl) welcomeEl.classList.toggle('hidden', state.tabs.length > 0);
}

function activateTab(id) {
  state.tabs.forEach((t) => {
    const on = t.id === id;
    t.btn.classList.toggle('active', on);
    t.el.classList.toggle('hidden', !on);
  });
  state.activeTabId = id;
  refreshWelcome();
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [tab] = state.tabs.splice(idx, 1);
  tab.btn.remove();
  tab.el.remove();
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    if (next) activateTab(next.id);
    else state.activeTabId = null;
  }
  refreshWelcome();
}

function closeTabsForConn(connId) {
  [...state.tabs].filter((t) => t.connId === connId).forEach((t) => closeTab(t.id));
}

function closeOtherTabs(keepId) {
  [...state.tabs].filter((t) => t.id !== keepId).forEach((t) => closeTab(t.id));
}

function closeAllTabs() {
  [...state.tabs].forEach((t) => closeTab(t.id));
}

function showTabContextMenu(e, tabId) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const close = el('div', 'ctx-item', '关闭');
  close.addEventListener('click', () => { closeContextMenu(); closeTab(tabId); });
  const closeOthers = el('div', 'ctx-item', '关闭其他');
  closeOthers.addEventListener('click', () => { closeContextMenu(); closeOtherTabs(tabId); });
  const closeAll = el('div', 'ctx-item', '全部关闭');
  closeAll.addEventListener('click', () => { closeContextMenu(); closeAllTabs(); });
  menu.appendChild(close);
  menu.appendChild(closeOthers);
  menu.appendChild(closeAll);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

function welcomePane() {
  return el('div', 'tab-pane');
}

/* ================= rendering helpers ================= */

function renderGrid(container, columns, rows) {
  container.innerHTML = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', 'rownum', '#'));
  columns.forEach((c) => hr.appendChild(el('th', null, c)));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  (rows || []).forEach((row, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'rownum', String(i + 1)));
    row.forEach((v) => {
      const f = formatValue(v);
      const td = el('td', f.cls, f.text);
      td.title = f.text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderBarChart(container, columns, rows) {
  container.innerHTML = '';
  if (!columns.length || !rows.length) { container.textContent = '无数据'; return; }
  let valueCol = -1;
  for (let i = 1; i < columns.length; i++) {
    const v = rows[0][i];
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))) { valueCol = i; break; }
  }
  if (valueCol < 0) { container.textContent = '没有可绘制的数值列'; return; }
  const values = rows.map((r) => { const n = Number(r[valueCol]); return isNaN(n) ? 0 : n; });
  const max = Math.max(...values, 1);
  const chart = el('div', 'chart');
  rows.slice(0, 100).forEach((r, i) => {
    const row = el('div', 'chart-row');
    row.appendChild(el('span', 'chart-label', String(r[0] ?? '').slice(0, 20)));
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    fill.style.width = Math.max(0.5, (values[i] / max * 100)) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'chart-value', String(values[i])));
    chart.appendChild(row);
  });
  container.appendChild(chart);
}

function openServerInfoTab(connId) {
  const conn = connById(connId);
  if (!conn) return;
  const tab = makeTab('server', '服务器 ' + (conn.name || ''), connId, {});
  const meta = el('div', 'results-meta', '加载中…');
  const grid = el('div', 'results-grid');
  tab.el.appendChild(meta);
  tab.el.appendChild(grid);
  activateTab(tab.id);
  window.api.serverInfo(connId).then((resp) => {
    if (resp && resp.error) { meta.className = 'results-meta err'; meta.textContent = '错误：' + resp.error; return; }
    meta.className = 'results-meta ok';
    meta.textContent = '服务器状态';
    renderGrid(grid, ['项目', '值'], resp.rows || []);
  });
  return tab;
}

function showQueryResults(tab, resp) {
  const meta = tab.meta;
  const grid = tab.grid;
  grid.innerHTML = '';
  if (resp.error) {
    meta.className = 'results-meta err';
    meta.textContent = '错误：' + resp.error;
    return;
  }
  if (!resp.results || !resp.results.length) {
    meta.className = 'results-meta ok';
    meta.textContent = '查询成功，影响 ' + resp.changes + ' 行' + (resp.saved ? '（已保存到文件）' : '');
    return;
  }
  const r = resp.results[0];
  tab.lastResult = r;
  meta.className = 'results-meta ok';
  meta.textContent = '返回 ' + r.rows.length + ' 行、' + r.columns.length + ' 列' +
    (resp.results.length > 1 ? '（共 ' + resp.results.length + ' 个结果集，仅显示第一个）' : '');
  if (tab.chartWrap) tab.chartWrap.classList.add('hidden');
  grid.classList.remove('hidden');
  renderGrid(grid, r.columns, r.rows);
}

/* ================= tabs: query & table ================= */

function highlightSql(sql) {
  let s = String(sql)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(/(--[^\n]*)/g, '<span class="tok-comment">$1</span>');
  s = s.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="tok-str">$1</span>');
  s = s.replace(/\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|AND|OR|NOT|NULL|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|LIMIT|OFFSET|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|DEFAULT|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|HAVING|UNION|ALL|IS|LIKE|IN|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END|TRUNCATE|DESCRIBE|SHOW|USE|DATABASE|DATABASES|TABLES|AUTO_INCREMENT|PRAGMA|ASC|DESC)\b/gi, '<span class="tok-keyword">$&</span>');
  s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return s;
}

function formatSql(sql) {
  let s = String(sql).replace(/\s+/g, ' ').trim();
  const keywords = /\b(select|from|where|insert|into|values|update|set|delete|create|drop|alter|table|join|left|right|inner|outer|full|cross|on|group|by|order|limit|offset|and|or|not|null|union|all|as|having|when|then|else|end|case|primary|key|foreign|references|unique|default|distinct|asc|desc)\b/gi;
  s = s.replace(keywords, (m) => m.toUpperCase());
  const clauses = /\b(SELECT|FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|CROSS JOIN|JOIN|GROUP BY|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION|HAVING|SET|VALUES|ON)\b/g;
  s = s.replace(clauses, '\n$1');
  s = s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return s;
}

const SQL_KEYWORDS = ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','DROP','ALTER','TABLE','AND','OR','NOT','NULL','JOIN','LEFT','RIGHT','INNER','OUTER','FULL','CROSS','ON','GROUP','BY','ORDER','LIMIT','OFFSET','PRIMARY','KEY','FOREIGN','REFERENCES','INDEX','UNIQUE','DEFAULT','AS','DISTINCT','COUNT','SUM','AVG','MIN','MAX','HAVING','UNION','ALL','IS','LIKE','IN','BETWEEN','EXISTS','CASE','WHEN','THEN','ELSE','END','TRUNCATE','DESCRIBE','SHOW','USE','DATABASE','DATABASES','TABLES','ASC','DESC','ADD','COLUMN','CONSTRAINT','VARCHAR','INT','INTEGER','BIGINT','TEXT','DATE','DATETIME','TIMESTAMP','DECIMAL','FLOAT','DOUBLE','BOOLEAN','AUTO_INCREMENT','PRAGMA','IF'];

let acBox = null;
let acState = null;
let histBox = null;
let snipBox = null;

function closeAutocomplete() {
  if (acBox) { acBox.remove(); acBox = null; }
  acState = null;
}

function acCurrentWord(text, caret) {
  const before = text.slice(0, caret);
  const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  return m ? m[0] : '';
}

const colCache = {};

function sqlTableContext(text) {
  const tables = [];
  const re = /\b(?:from|join|update|into)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(text))) tables.push(m[1]);
  return tables;
}

function acCandidates(prefix) {
  const conn = activeConn();
  const tables = (conn && conn.tables) ? conn.tables.filter((t) => t.type !== 'database').map((t) => t.name) : [];
  const list = [];
  SQL_KEYWORDS.forEach((k) => { if (k.length > prefix.length && k.toLowerCase().slice(0, prefix.length) === prefix) list.push({ kind: '关键字', text: k }); });
  tables.forEach((t) => { if (t.toLowerCase().slice(0, prefix.length) === prefix) list.push({ kind: '表', text: t }); });
  return list;
}

function acRender(editor) {
  if (!acState || !acBox) return;
  acBox.innerHTML = '';
  acState.items.forEach((it, i) => {
    const d = el('div', 'ac-item' + (i === acState.activeIdx ? ' active' : ''));
    d.appendChild(el('span', 'ac-kind', it.kind));
    d.appendChild(el('span', 'ac-text', it.text));
    d.addEventListener('mousedown', (e) => { e.preventDefault(); acApply(editor, it); });
    acBox.appendChild(d);
  });
}

function acApply(editor, it) {
  const text = editor.value;
  const caret = editor.selectionStart;
  const wordStart = caret - acCurrentWord(text, caret).length;
  editor.value = text.slice(0, wordStart) + it.text + text.slice(caret);
  const pos = wordStart + it.text.length;
  editor.selectionStart = editor.selectionEnd = pos;
  editor.dispatchEvent(new Event('input'));
  closeAutocomplete();
  editor.focus();
}

async function acOpen(editor) {
  closeAutocomplete();
  const text = editor.value;
  const caret = editor.selectionStart;
  const word = acCurrentWord(text, caret);
  if (!word) return;
  const prefix = word.toLowerCase();
  const items = acCandidates(prefix);
  const conn = activeConn();
  if (conn && conn.id) {
    const tables = sqlTableContext(text.slice(0, caret));
    for (const t of tables) {
      const key = conn.id + ':' + t;
      let cols = colCache[key];
      if (!cols) {
        const info = await window.api.tableInfo(conn.id, t);
        cols = (info && info.ok) ? info.columns.map((c) => c.name) : [];
        colCache[key] = cols;
      }
      cols.forEach((c) => { if (c.toLowerCase().slice(0, prefix.length) === prefix) items.push({ kind: '字段', text: c }); });
    }
  }
  if (editor.selectionStart !== caret || acCurrentWord(editor.value, editor.selectionStart) !== word) return;
  const seen = new Set();
  const uniq = items.filter((i) => { const k = i.kind + ':' + i.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  if (!uniq.length) return;
  const box = el('div', 'ac-box');
  const rect = editor.getBoundingClientRect();
  box.style.left = Math.min(rect.left + 12, window.innerWidth - 240) + 'px';
  box.style.top = Math.min(rect.bottom + 2, window.innerHeight - 220) + 'px';
  document.body.appendChild(box);
  acBox = box;
  acState = { items: uniq, activeIdx: 0 };
  acRender(editor);
}

function acHandleKey(editor, e) {
  if (!acState || !acBox) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); acState.activeIdx = (acState.activeIdx + 1) % acState.items.length; acRender(editor); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); acState.activeIdx = (acState.activeIdx - 1 + acState.items.length) % acState.items.length; acRender(editor); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acApply(editor, acState.items[acState.activeIdx]); return true; }
  if (e.key === 'Escape') { closeAutocomplete(); return true; }
  return false;
}

const QUERY_HISTORY_KEY = 'queryHistory';
function loadQueryHistory() { try { return JSON.parse(localStorage.getItem(QUERY_HISTORY_KEY) || '[]'); } catch (e) { return []; } }
function saveQueryHistory(sql) {
  const s = String(sql || '').trim();
  if (!s) return;
  const list = loadQueryHistory().filter((x) => x !== s);
  list.unshift(s);
  try { localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) { /* ignore */ }
}
function closeQueryHistory() { if (histBox) { histBox.remove(); histBox = null; } }
function showQueryHistory(editor, btn) {
  closeQueryHistory();
  const list = loadQueryHistory();
  if (!list.length) { setStatus('暂无查询历史', ''); return; }
  const box = el('div', 'ac-box');
  box.style.minWidth = '320px';
  box.style.maxWidth = '560px';
  list.slice(0, 20).forEach((sql) => {
    const d = el('div', 'ac-item');
    const label = sql.length > 70 ? sql.slice(0, 70) + '…' : sql;
    d.appendChild(el('span', 'ac-text', label));
    d.title = sql;
    d.addEventListener('mousedown', (e) => { e.preventDefault(); editor.value = sql; editor.dispatchEvent(new Event('input')); closeQueryHistory(); editor.focus(); });
    box.appendChild(d);
  });
  const rect = btn.getBoundingClientRect();
  box.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
  box.style.top = (rect.bottom + 2) + 'px';
  document.body.appendChild(box);
  histBox = box;
}

const SNIPPETS_KEY = 'sqlSnippets';
function loadSnippets() { try { return JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '[]'); } catch (e) { return []; } }
function saveSnippet(name, sql) {
  if (!name || !sql) return;
  const list = loadSnippets().filter((s) => s.name !== name);
  list.unshift({ name, sql });
  try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) { /* ignore */ }
}
function closeSnippets() { if (snipBox) { snipBox.remove(); snipBox = null; } }
function showSnippets(editor, btn) {
  closeSnippets();
  closeQueryHistory();
  const list = loadSnippets();
  const box = el('div', 'ac-box');
  box.style.minWidth = '300px';
  box.style.maxWidth = '520px';
  snipBox = box;
  const saveItem = el('div', 'ac-item');
  saveItem.appendChild(el('span', 'ac-kind', '＋'));
  saveItem.appendChild(el('span', 'ac-text', '保存当前选中为片段…'));
  saveItem.addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeSnippets();
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim() || editor.value.trim();
    if (!sel) { setStatus('没有可保存的 SQL', ''); return; }
    promptModal('片段名称：', '').then((name) => {
      if (name && name.trim()) { saveSnippet(name.trim(), sel); setStatus('已保存片段「' + name.trim() + '」', ''); }
    });
  });
  box.appendChild(saveItem);
  if (!list.length) {
    const empty = el('div', 'ac-item');
    empty.appendChild(el('span', 'ac-text', '（暂无片段）'));
    box.appendChild(empty);
  } else {
    list.forEach((s) => {
      const d = el('div', 'ac-item');
      d.appendChild(el('span', 'ac-kind', '片段'));
      d.appendChild(el('span', 'ac-text', s.name));
      d.title = s.sql;
      d.addEventListener('mousedown', (e) => { e.preventDefault(); closeSnippets(); editor.value = s.sql; editor.dispatchEvent(new Event('input')); editor.focus(); });
      box.appendChild(d);
    });
  }
  const rect = btn.getBoundingClientRect();
  box.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
  box.style.top = (rect.bottom + 2) + 'px';
  document.body.appendChild(box);
}

function openQueryTab(connId) {
  const conn = connById(connId);
  const tab = makeTab('query', '查询 ' + (state.tabSeq + 1), connId, { sql: '' });

  const bar = el('div', 'editor-toolbar');
  const runBtn = el('button', 'run', '▶ 运行');
  const fmtBtn = el('button', 'tb', '格式化');
  const histBtn = el('button', 'tb', '历史');
  const snipBtn = el('button', 'tb', '片段');
  const chartBtn = el('button', 'tb', '图表');
  const hint = el('span', 'hint', 'Ctrl+Enter 运行 · 选中后只运行选中部分');
  bar.appendChild(runBtn);
  bar.appendChild(fmtBtn);
  bar.appendChild(histBtn);
  bar.appendChild(snipBtn);
  bar.appendChild(chartBtn);
  bar.appendChild(hint);

  const editorWrap = el('div', 'sql-editor-wrap');
  const highlighter = el('pre', 'sql-highlight');
  highlighter.setAttribute('aria-hidden', 'true');
  const editor = el('textarea', 'sql-editor');
  editor.placeholder = '在此输入 SQL 语句，例如：SELECT * FROM 表名;';
  editor.spellcheck = false;
  editor.autocorrect = 'off';
  editor.autocapitalize = 'off';
  editorWrap.appendChild(highlighter);
  editorWrap.appendChild(editor);

  const results = el('div', 'results');
  const meta = el('div', 'results-meta', '尚未执行');
  const grid = el('div', 'results-grid');
  const chartWrap = el('div', 'chart-wrap hidden');
  results.appendChild(meta);
  results.appendChild(grid);
  results.appendChild(chartWrap);

  tab.editor = editor;
  tab.meta = meta;
  tab.grid = grid;
  tab.chartWrap = chartWrap;
  tab.lastResult = null;

  tab.el.appendChild(bar);
  tab.el.appendChild(editorWrap);
  tab.el.appendChild(results);

  const run = async () => {
    const connNow = connById(state.activeId);
    if (!connNow) { meta.className = 'results-meta err'; meta.textContent = '请先打开或选择一个数据库连接'; return; }
    meta.className = 'results-meta';
    meta.textContent = '执行中…';
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    const sqlToRun = sel || editor.value;
    const resp = await window.api.query(state.activeId, sqlToRun);
    saveQueryHistory(sqlToRun);
    showQueryResults(tab, resp);
  };

  runBtn.addEventListener('click', run);
  histBtn.addEventListener('click', () => showQueryHistory(editor, histBtn));
  snipBtn.addEventListener('click', () => showSnippets(editor, snipBtn));
  chartBtn.addEventListener('click', () => {
    if (!tab.lastResult || !tab.lastResult.rows.length) { setStatus('请先运行一个返回结果的查询', ''); return; }
    const wasHidden = tab.chartWrap.classList.contains('hidden');
    if (wasHidden) {
      renderBarChart(tab.chartWrap, tab.lastResult.columns, tab.lastResult.rows);
      tab.chartWrap.classList.remove('hidden');
      grid.classList.add('hidden');
    } else {
      tab.chartWrap.classList.add('hidden');
      grid.classList.remove('hidden');
    }
  });
  fmtBtn.addEventListener('click', () => {
    editor.value = formatSql(editor.value);
    editor.dispatchEvent(new Event('input'));
    editor.focus();
  });
  editor.addEventListener('keydown', (e) => {
    if (acHandleKey(editor, e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
  });

  const syncHighlight = () => {
    highlighter.innerHTML = highlightSql(editor.value) + '\n';
    highlighter.scrollTop = editor.scrollTop;
    highlighter.scrollLeft = editor.scrollLeft;
  };
  editor.addEventListener('input', () => { syncHighlight(); acOpen(editor); });
  editor.addEventListener('scroll', syncHighlight);
  syncHighlight();

  activateTab(tab.id);
  editor.focus();
  return tab;
}

function qIdent(conn, name) {
  if (conn && conn.type === 'mysql') return '`' + String(name).replace(/`/g, '``') + '`';
  if (conn && conn.type === 'mssql') return '[' + String(name).replace(/\]/g, ']]') + ']';
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function qualifiedTable(conn, db, table) {
  if (db) return qIdent(conn, db) + '.' + qIdent(conn, table);
  return qIdent(conn, table);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function openTableTab(connId, table) {
  const existing = state.tabs.find((t) => t.type === 'table' && t.connId === connId && t.table === table);
  if (existing) { activateTab(existing.id); return existing; }

  const tab = makeTab('table', table, connId, { table });

  const subbar = el('div', 'subtabbar');
  const btnData = el('button', 'subtab active', '数据');
  const btnStruct = el('button', 'subtab', '结构');
  const btnDdl = el('button', 'subtab', 'DDL');
  btnData.addEventListener('click', () => switchSubTab(tab, 'data'));
  btnStruct.addEventListener('click', () => switchSubTab(tab, 'structure'));
  btnDdl.addEventListener('click', () => switchSubTab(tab, 'ddl'));
  subbar.appendChild(btnData);
  subbar.appendChild(btnStruct);
  subbar.appendChild(btnDdl);

  const dataPane = el('div', 'pane');
  const bar = el('div', 'editor-toolbar');
  const refreshBtn = el('button', 'run', '↻ 刷新');
  const addBtn = el('button', 'tb', '＋ 新增行');
  const saveBtn = el('button', 'run', '保存');
  const csvBtn = el('button', 'tb', '导出 CSV');
  const prevBtn = el('button', 'tb', '‹ 上一页');
  const nextBtn = el('button', 'tb', '下一页 ›');
  const filterInput = el('input', 'filter-input');
  filterInput.placeholder = '筛选，如 age > 30';
  const applyFilter = el('button', 'tb', '筛选');
  const clearFilter = el('button', 'tb', '清除');
  const hint = el('span', 'hint', '点击单元格直接编辑');
  [refreshBtn, addBtn, saveBtn, csvBtn, prevBtn, nextBtn].forEach((b) => bar.appendChild(b));
  bar.appendChild(filterInput);
  bar.appendChild(applyFilter);
  bar.appendChild(clearFilter);
  bar.appendChild(hint);

  const body = el('div', 'data-body');
  const gridArea = el('div', 'data-grid-area');
  const meta = el('div', 'results-meta', '加载中…');
  const gridWrap = el('div', 'results-grid');
  const infoPanel = el('div', 'table-info');
  gridArea.appendChild(meta);
  gridArea.appendChild(gridWrap);
  body.appendChild(gridArea);
  body.appendChild(infoPanel);
  dataPane.appendChild(bar);
  dataPane.appendChild(body);

  const structPane = el('div', 'pane hidden');
  const structMeta = el('div', 'results-meta', '');
  const structWrap = el('div', 'results-grid');
  structPane.appendChild(structMeta);
  structPane.appendChild(structWrap);

  const ddlPane = el('div', 'pane hidden');
  const ddlPre = el('pre', 'ddl-view', '');
  ddlPane.appendChild(ddlPre);

  tab.el.appendChild(subbar);
  tab.el.appendChild(dataPane);
  tab.el.appendChild(structPane);
  tab.el.appendChild(ddlPane);

  tab.subData = btnData;
  tab.subStruct = btnStruct;
  tab.subDdl = btnDdl;
  tab.dataPane = dataPane;
  tab.structPane = structPane;
  tab.ddlPane = ddlPane;
  tab.ddlPre = ddlPre;
  tab.meta = meta;
  tab.gridWrap = gridWrap;
  tab.infoPanel = infoPanel;
  tab.structMeta = structMeta;
  tab.structWrap = structWrap;
  tab.columns = [];
  tab.pk = null;
  tab.rows = [];
  tab.page = 1;
  tab.pageSize = 200;
  tab.total = 0;
  tab.sortCol = null;
  tab.sortDir = 'asc';
  tab.filter = '';
  tab.filterInput = filterInput;
  tab.prevBtn = prevBtn;
  tab.nextBtn = nextBtn;

  refreshBtn.addEventListener('click', () => loadData(tab));
  addBtn.addEventListener('click', () => addRow(tab));
  saveBtn.addEventListener('click', () => saveEdits(tab));
  csvBtn.addEventListener('click', () => exportCsv(tab));
  prevBtn.addEventListener('click', () => { if (tab.page > 1) { tab.page--; loadData(tab); } });
  nextBtn.addEventListener('click', () => { if (tab.page * tab.pageSize < tab.total) { tab.page++; loadData(tab); } });
  applyFilter.addEventListener('click', () => { tab.filter = filterInput.value.trim(); tab.page = 1; loadData(tab); });
  clearFilter.addEventListener('click', () => { filterInput.value = ''; tab.filter = ''; tab.page = 1; loadData(tab); });
  filterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { tab.filter = filterInput.value.trim(); tab.page = 1; loadData(tab); } });

  activateTab(tab.id);
  loadData(tab);
  loadStructure(tab);
  return tab;
}

function switchSubTab(tab, which) {
  tab.subData.classList.toggle('active', which === 'data');
  tab.subStruct.classList.toggle('active', which === 'structure');
  tab.subDdl.classList.toggle('active', which === 'ddl');
  tab.dataPane.classList.toggle('hidden', which !== 'data');
  tab.structPane.classList.toggle('hidden', which !== 'structure');
  tab.ddlPane.classList.toggle('hidden', which !== 'ddl');
  if (which === 'ddl') loadDdl(tab);
}

async function loadDdl(tab) {
  const resp = await window.api.ddl(tab.connId, tab.table);
  tab.ddlPre.textContent = (resp && resp.ok) ? (resp.ddl || '（无 DDL）') : ('错误：' + ((resp && resp.error) || '加载失败'));
}

async function loadData(tab) {
  tab.meta.className = 'results-meta';
  tab.meta.textContent = '加载中…';
  const offset = (tab.page - 1) * tab.pageSize;
  const resp = await window.api.tableData(tab.connId, tab.table, tab.pageSize, offset, tab.filter);
  if (resp.error) {
    tab.meta.className = 'results-meta err';
    tab.meta.textContent = '错误：' + resp.error;
    tab.gridWrap.innerHTML = '';
    return;
  }
  const info = await window.api.tableInfo(tab.connId, tab.table);
  tab.columns = resp.columns;
  tab.pk = (info && info.ok && info.primaryKey && info.primaryKey.length === 1) ? info.primaryKey[0] : null;
  tab.rows = resp.rows.map((r) => ({ orig: r.slice(), cur: r.slice(), state: 'clean' }));
  tab.total = resp.total;
  const totalPages = Math.max(1, Math.ceil(resp.total / tab.pageSize));
  tab.meta.className = 'results-meta ok';
  tab.meta.textContent = '共 ' + resp.total + ' 行 · 第 ' + tab.page + '/' + totalPages + ' 页' + (tab.pk ? ' · 可编辑' : ' · 只读');
  tab.prevBtn.disabled = tab.page <= 1;
  tab.nextBtn.disabled = tab.page >= totalPages;
  renderDataGrid(tab);
  renderTableInfo(tab);
}

function renderDataGrid(tab) {
  const wrap = tab.gridWrap;
  wrap.innerHTML = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', 'rownum', ''));
  hr.appendChild(el('th', 'rownum', '#'));
  tab.columns.forEach((c) => {
    const th = el('th', 'sortable', c);
    if (tab.sortCol === c) th.textContent = c + (tab.sortDir === 'asc' ? ' ▲' : ' ▼');
    th.addEventListener('click', () => sortData(tab, c));
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  tab.rows.forEach((row, ri) => {
    const tr = el('tr');
    if (row.state === 'deleted') tr.classList.add('row-deleted');
    const tdDel = el('td', 'rownum');
    const delBtn = el('button', 'row-del', '×');
    delBtn.title = '删除/恢复该行';
    delBtn.addEventListener('click', () => {
      row.state = (row.state === 'deleted') ? 'edited' : 'deleted';
      tr.classList.toggle('row-deleted', row.state === 'deleted');
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tr.appendChild(el('td', 'rownum', String(ri + 1)));
    row.cur.forEach((v, ci) => {
      const td = el('td');
      const input = el('input', 'cell-input');
      input.value = (v === null || v === undefined) ? '' : String(v);
      input.addEventListener('input', () => {
        row.cur[ci] = input.value;
        if (row.state === 'clean') row.state = 'edited';
      });
      td.appendChild(input);
      td.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); showCellContextMenu(ev, row, ci); });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function sortData(tab, col) {
  const ci = tab.columns.indexOf(col);
  if (ci < 0) return;
  if (tab.sortCol === col) {
    tab.sortDir = tab.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    tab.sortCol = col;
    tab.sortDir = 'asc';
  }
  tab.rows.sort((a, b) => {
    const av = a.cur[ci], bv = b.cur[ci];
    const an = Number(av), bn = Number(bv);
    const aNum = av !== '' && av !== null && av !== undefined && !isNaN(an);
    const bNum = bv !== '' && bv !== null && bv !== undefined && !isNaN(bn);
    let cmp;
    if (aNum && bNum) cmp = an - bn;
    else cmp = String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv));
    return tab.sortDir === 'asc' ? cmp : -cmp;
  });
  renderDataGrid(tab);
}

function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  ta.remove();
  setStatus('已复制', '');
}

function showCellContextMenu(e, row, ci) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const cell = el('div', 'ctx-item', '复制单元格值');
  cell.addEventListener('click', () => { closeContextMenu(); copyText(row.cur[ci] == null ? '' : String(row.cur[ci])); });
  const rowItem = el('div', 'ctx-item', '复制整行（TSV）');
  rowItem.addEventListener('click', () => { closeContextMenu(); copyText(row.cur.map((v) => v == null ? '' : String(v)).join('\t')); });
  menu.appendChild(cell);
  menu.appendChild(rowItem);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

function renderTableInfo(tab) {
  const p = tab.infoPanel;
  if (!p) return;
  p.innerHTML = '';
  p.appendChild(el('div', 'ti-title', tab.table));
  p.appendChild(el('div', 'ti-meta', '共 ' + (tab.total || 0) + ' 行'));
  const cols = (tab.colInfo && tab.colInfo.length) ? tab.colInfo : tab.columns.map((name) => ({ name, type: '', pk: false }));
  p.appendChild(el('div', 'ti-head', '字段（' + cols.length + '）'));
  const colList = el('div', 'ti-list');
  cols.forEach((c) => {
    const row = el('div', 'ti-row');
    row.appendChild(el('span', 'ti-mark', c.pk ? 'PK' : ''));
    row.appendChild(el('span', 'ti-col-name', c.name));
    row.appendChild(el('span', 'ti-col-type', c.type || ''));
    colList.appendChild(row);
  });
  p.appendChild(colList);
  if (tab.primaryKey && tab.primaryKey.length) {
    p.appendChild(el('div', 'ti-head', '主键'));
    p.appendChild(el('div', 'ti-meta', tab.primaryKey.join(', ')));
  }
}

async function loadStructure(tab) {
  tab.structMeta.className = 'results-meta';
  tab.structMeta.textContent = '加载中…';
  const info = await window.api.tableInfo(tab.connId, tab.table);
  if (!info || info.error) {
    tab.structMeta.className = 'results-meta err';
    tab.structMeta.textContent = '错误：' + (info && info.error ? info.error : '加载失败');
    tab.structWrap.innerHTML = '';
    return;
  }
  tab.structMeta.className = 'results-meta ok';
  tab.structMeta.textContent = '字段 ' + info.columns.length + ' 个，索引 ' + info.indexes.length + ' 个';
  tab.colInfo = info.columns;
  tab.indexes = info.indexes;
  tab.primaryKey = info.primaryKey;
  renderTableInfo(tab);
  tab.structWrap.innerHTML = '';

  const colsTitle = el('div', 'struct-title', '字段');
  tab.structWrap.appendChild(colsTitle);
  const ct = el('table', 'grid');
  const chead = el('thead');
  const chr = el('tr');
  ['#', '字段名', '类型', '非空', '主键', '默认值'].forEach((h) => chr.appendChild(el('th', null, h)));
  chead.appendChild(chr);
  ct.appendChild(chead);
  const cbody = el('tbody');
  info.columns.forEach((c, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'rownum', String(i + 1)));
    tr.appendChild(el('td', null, c.name));
    tr.appendChild(el('td', null, c.type));
    tr.appendChild(el('td', null, c.notnull ? '是' : '否'));
    tr.appendChild(el('td', null, c.pk ? '★' : ''));
    tr.appendChild(el('td', null, c.dflt == null ? '' : String(c.dflt)));
    cbody.appendChild(tr);
  });
  ct.appendChild(cbody);
  tab.structWrap.appendChild(ct);

  if (info.indexes && info.indexes.length) {
    const idxTitle = el('div', 'struct-title', '索引');
    tab.structWrap.appendChild(idxTitle);
    const it = el('table', 'grid');
    const ihead = el('thead');
    const ihrow = el('tr');
    ['索引名', '唯一', '字段'].forEach((h) => ihrow.appendChild(el('th', null, h)));
    ihead.appendChild(ihrow);
    it.appendChild(ihead);
    const ibody = el('tbody');
    info.indexes.forEach((ix) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, ix.name));
      tr.appendChild(el('td', null, ix.unique ? '是' : '否'));
      tr.appendChild(el('td', null, ix.columns || ''));
      ibody.appendChild(tr);
    });
    it.appendChild(ibody);
    tab.structWrap.appendChild(it);
  }
}

function addRow(tab) {
  const cols = tab.columns.length || 1;
  tab.rows.push({ orig: new Array(cols).fill(null), cur: new Array(cols).fill(''), state: 'new' });
  renderDataGrid(tab);
  tab.gridWrap.scrollTop = tab.gridWrap.scrollHeight;
}

async function saveEdits(tab) {
  if (!tab.pk) { setStatus('该表无单一主键，无法编辑保存', ''); return; }
  const conn = connById(tab.connId);
  if (!conn) return;
  const pkIdx = tab.columns.indexOf(tab.pk);
  const tbl = qIdent(conn, tab.table);
  const statements = [];
  for (const row of tab.rows) {
    if (row.state === 'deleted') {
      const pkVal = row.orig[pkIdx];
      statements.push({ sql: 'DELETE FROM ' + tbl + ' WHERE ' + qIdent(conn, tab.pk) + ' = ?', params: [pkVal] });
    } else if (row.state === 'edited') {
      const sets = [];
      const params = [];
      for (let ci = 0; ci < tab.columns.length; ci++) {
        if (String(row.cur[ci]) !== String(row.orig[ci])) {
          sets.push(qIdent(conn, tab.columns[ci]) + ' = ?');
          params.push(row.cur[ci]);
        }
      }
      if (sets.length) {
        params.push(row.orig[pkIdx]);
        statements.push({ sql: 'UPDATE ' + tbl + ' SET ' + sets.join(', ') + ' WHERE ' + qIdent(conn, tab.pk) + ' = ?', params });
      }
    } else if (row.state === 'new') {
      const cols = [];
      const vals = [];
      for (let ci = 0; ci < tab.columns.length; ci++) {
        const v = row.cur[ci];
        if (v !== '' && v !== null && v !== undefined) {
          cols.push(qIdent(conn, tab.columns[ci]));
          vals.push(v);
        }
      }
      if (cols.length) {
        statements.push({ sql: 'INSERT INTO ' + tbl + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', params: vals });
      }
    }
  }
  if (!statements.length) { setStatus('没有需要保存的修改', ''); return; }
  let err = null;
  for (const s of statements) {
    const resp = await window.api.execute(tab.connId, s.sql, s.params);
    if (resp && resp.error) { err = resp.error; break; }
  }
  if (err) { setStatus('保存失败：' + err, ''); }
  else { setStatus('已保存', ''); await loadData(tab); }
}

async function exportCsv(tab) {
  const header = tab.columns.map(csvEscape).join(',');
  const lines = tab.rows.filter((r) => r.state !== 'deleted').map((r) => r.cur.map(csvEscape).join(','));
  const csv = [header].concat(lines).join('\r\n');
  const resp = await window.api.exportCsv({ csv, defaultName: tab.table + '.csv' });
  if (resp && resp.ok) setStatus('已导出到 ' + resp.path, '');
  else if (resp && resp.error) setStatus('导出失败：' + resp.error, '');
}

/* ================= sidebar ================= */

function makeTreeItem(conn, t) {
  const item = el('div', 'tree-item');
  const isDb = t.type === 'database';
  item.appendChild(el('span', 'ico', isDb ? '🗄' : (t.type === 'view' ? '👁' : '▦')));
  item.appendChild(el('span', null, t.name));
  if (!isDb && t.type !== 'view' && conn.tableCounts && conn.tableCounts[t.name] !== undefined) {
    item.appendChild(el('span', 'tcount', String(conn.tableCounts[t.name])));
  }
  item.addEventListener('click', () => {
    state.activeId = conn.id;
    refreshConnSelect();
    if (isDb) useDatabase(conn.id, t.name);
    else openTableTab(conn.id, t.name);
  });
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDb) showDatabaseContextMenu(e, conn, t);
    else showTableContextMenu(e, conn, t);
  });
  return item;
}

function makeFolder(conn, label, list) {
  const f = el('div', 'tree-folder');
  const fh = el('div', 'tree-folder-head');
  const caret = el('span', 'caret open', '▶');
  fh.appendChild(caret);
  fh.appendChild(el('span', null, label));
  const fc = el('div', 'tree-folder-items');
  list.forEach((t) => fc.appendChild(makeTreeItem(conn, t)));
  fh.addEventListener('click', () => {
    const collapsed = fc.classList.toggle('collapsed');
    caret.classList.toggle('open', !collapsed);
  });
  f.appendChild(fh);
  f.appendChild(fc);
  return f;
}

function makeDatabaseNode(conn, db) {
  const node = el('div', 'tree-folder');
  const isActive = db.name === conn.database;
  const head = el('div', 'tree-folder-head' + (isActive ? ' active' : ''));
  const caret = el('span', 'caret' + (isActive ? ' open' : ''), '▶');
  head.appendChild(caret);
  head.appendChild(el('span', 'ico', '🗄'));
  head.appendChild(el('span', null, db.name));
  const fc = el('div', 'tree-folder-items' + (isActive ? '' : ' collapsed'));
  if (isActive) {
    const tables = (conn.tables || []).filter((t) => t.type !== 'view' && t.type !== 'database');
    const views = (conn.tables || []).filter((t) => t.type === 'view');
    if (tables.length) fc.appendChild(makeFolder(conn, '表', tables));
    if (views.length) fc.appendChild(makeFolder(conn, '视图', views));
    if (!tables.length && !views.length) fc.appendChild(el('div', 'tree-empty', '（无表）'));
  }
  head.addEventListener('click', () => {
    if (isActive) {
      const collapsed = fc.classList.toggle('collapsed');
      caret.classList.toggle('open', !collapsed);
    } else {
      useDatabase(conn.id, db.name);
    }
  });
  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showDatabaseContextMenu(e, conn, db);
  });
  node.appendChild(head);
  node.appendChild(fc);
  return node;
}

function buildTree() {
  const tree = $('#tree');
  tree.innerHTML = '';

  if (state.connections.length) {
    state.connections.forEach((conn) => {
      const group = el('div', 'conn-group');
      const head = el('div', 'conn-head' + (conn.id === state.activeId ? ' active' : ''));
      const caret = el('span', 'caret open', '▶');
      const ico = el('span', 'conn-ico', connIcon(conn));
      const title = el('div');
      const nameSpan = el('span', 'conn-name', conn.name);
      title.appendChild(nameSpan);
      title.appendChild(el('span', 'path', connSubtitle(conn)));
      head.appendChild(caret);
      head.appendChild(ico);
      head.appendChild(title);
      conn._nameSpan = nameSpan;
      nameSpan.addEventListener('dblclick', (e) => { e.stopPropagation(); renameConnectionInline(conn); });

      const items = el('div', 'conn-items');

      if (isRemote(conn)) {
        const dbs = conn.databases || [];
        dbs.forEach((db) => items.appendChild(makeDatabaseNode(conn, db)));
        if (!dbs.length) items.appendChild(el('div', 'tree-empty', '（无数据库）'));
      } else {
        const tables = (conn.tables || []).filter((t) => t.type !== 'view' && t.type !== 'database');
        const views = (conn.tables || []).filter((t) => t.type === 'view');
        if (tables.length) items.appendChild(makeFolder(conn, '表', tables));
        if (views.length) items.appendChild(makeFolder(conn, '视图', views));
        if (!tables.length && !views.length) items.appendChild(el('div', 'tree-empty', '（无表）'));
      }

      head.addEventListener('click', () => {
        const collapsed = items.classList.toggle('collapsed');
        caret.classList.toggle('open', !collapsed);
      });
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConnContextMenu(e, conn);
      });

      group.appendChild(head);
      group.appendChild(items);
      tree.appendChild(group);
    });
  }

  // recent files
  const recent = el('div', 'recent-group');
  recent.appendChild(el('div', 'recent-title', '最近打开'));
  const recentList = el('div');
  loadRecentInto(recentList);
  recent.appendChild(recentList);
  tree.appendChild(recent);

  // saved connections
  const saved = el('div', 'recent-group');
  saved.appendChild(el('div', 'recent-title', '已保存的连接'));
  const savedList = el('div');
  loadSavedConnections(savedList);
  saved.appendChild(savedList);
  tree.appendChild(saved);
}

async function loadRecentInto(container) {
  const list = await window.api.recent();
  if (!list || !list.length) {
    container.appendChild(el('div', 'tree-empty', '（空）'));
    return;
  }
  list.forEach((p) => {
    const item = el('div', 'recent-item', p);
    item.title = p;
    item.addEventListener('click', () => openPath(p));
    container.appendChild(item);
  });
}

function saveRemoteConnection(cfg) {
  try {
    const key = 'savedConnections';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const idx = list.findIndex((c) => c.type === cfg.type && c.host === cfg.host && String(c.port) === String(cfg.port) && c.database === cfg.database);
    if (idx >= 0) list[idx] = cfg; else list.unshift(cfg);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 30)));
  } catch (e) { /* ignore */ }
}

const savedTypeIcon = { mysql: '🐬', mariadb: '🦭', postgres: '🐘', mssql: '🏢' };

function loadSavedConnections(container) {
  try {
    const list = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    if (!list.length) { container.appendChild(el('div', 'tree-empty', '（空）')); return; }
    list.forEach((c) => {
      const item = el('div', 'recent-item', (savedTypeIcon[c.type] || '🗄') + ' ' + (c.name || (c.user + '@' + c.host + ':' + c.port + (c.database ? '/' + c.database : ''))));
      item.title = '点击重新连接';
      item.addEventListener('click', () => reconnectRemote(c));
      container.appendChild(item);
    });
  } catch (e) { /* ignore */ }
}

async function reconnectRemote(cfg) {
  let conn;
  if (cfg.type === 'postgres') conn = await window.api.pgConnect(cfg);
  else if (cfg.type === 'mssql') conn = await window.api.mssqlConnect(cfg);
  else conn = await window.api.mysqlConnect({ ...cfg, flavor: cfg.type === 'mariadb' ? 'mariadb' : 'mysql' });
  if (conn && conn.error) { setStatus('连接失败：' + conn.error, ''); return; }
  addConnection(conn);
}

/* ================= connection management ================= */

function addConnection(conn) {
  if (!conn || conn.error) {
    if (conn && conn.error) setStatus('错误：' + conn.error, '');
    return;
  }
  const existing = state.connections.findIndex((c) => c.id === conn.id);
  if (existing >= 0) state.connections[existing] = conn;
  else state.connections.push(conn);
  state.activeId = conn.id;
  refreshConnSelect();
  buildTree();
  loadTableCounts(conn);
  setStatus(conn.name, connSubtitle(conn));
}

function refreshConnSelect() {
  const sel = $('#conn-select');
  sel.innerHTML = '';
  if (!state.connections.length) {
    sel.appendChild(el('option', null, '（无连接）'));
    $('#conn-info').textContent = '';
    return;
  }
  state.connections.forEach((c) => {
    const opt = el('option', null, c.name);
    opt.value = String(c.id);
    sel.appendChild(opt);
  });
  if (state.activeId != null) sel.value = String(state.activeId);
  const info = $('#conn-info');
  const c = activeConn();
  info.textContent = c ? connSubtitle(c) : '';
}

async function openFile() {
  const conn = await window.api.openFile();
  addConnection(conn);
}

async function createFile() {
  const conn = await window.api.createFile();
  addConnection(conn);
}

async function openPath(p) {
  const conn = await window.api.openPath(p);
  addConnection(conn);
}

async function saveActive() {
  const id = state.activeId;
  if (id == null) { setStatus('没有可保存的连接', ''); return; }
  const ok = await window.api.save(id);
  setStatus(ok ? '已保存' : '保存失败', ok ? '' : activeConn()?.path || '');
  return ok;
}

async function closeConnection(id) {
  const conn = connById(id);
  await window.api.close(id);
  state.connections = state.connections.filter((c) => c.id !== id);
  closeTabsForConn(id);
  if (state.activeId === id) state.activeId = state.connections.length ? state.connections[0].id : null;
  refreshConnSelect();
  buildTree();
  setStatus(conn ? '已关闭 ' + conn.name : '', '');
}

function closeActive() {
  if (state.activeId != null) closeConnection(state.activeId);
}

/* ================= mysql ================= */

function mysqlConnect() {
  $('#m-error').textContent = '';
  $('#mysql-modal').classList.remove('hidden');
  $('#m-host').focus();
}

async function submitMysqlConnect() {
  const cfg = {
    name: $('#m-name').value.trim(),
    flavor: $('#m-flavor').value,
    host: $('#m-host').value.trim(),
    port: $('#m-port').value.trim(),
    user: $('#m-user').value.trim(),
    password: $('#m-password').value,
    database: $('#m-database').value.trim(),
  };
  const conn = await window.api.mysqlConnect(cfg);
  if (conn && conn.error) {
    $('#m-error').textContent = conn.error;
    return;
  }
  $('#mysql-modal').classList.add('hidden');
  addConnection(conn);
  saveRemoteConnection({ type: conn.flavor === 'mariadb' ? 'mariadb' : 'mysql', name: conn.name, host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database });
}

function pgConnect() {
  $('#pg-error').textContent = '';
  $('#pg-modal').classList.remove('hidden');
  $('#pg-host').focus();
}

async function submitPgConnect() {
  const cfg = {
    name: $('#pg-name').value.trim(),
    host: $('#pg-host').value.trim(),
    port: $('#pg-port').value.trim(),
    user: $('#pg-user').value.trim(),
    password: $('#pg-password').value,
    database: $('#pg-database').value.trim(),
  };
  const conn = await window.api.pgConnect(cfg);
  if (conn && conn.error) {
    $('#pg-error').textContent = conn.error;
    return;
  }
  $('#pg-modal').classList.add('hidden');
  addConnection(conn);
  saveRemoteConnection({ type: 'postgres', name: conn.name, host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database });
}

function mssqlConnect() {
  $('#ms-error').textContent = '';
  $('#mssql-modal').classList.remove('hidden');
  $('#ms-host').focus();
}

async function submitMssqlConnect() {
  const cfg = {
    name: $('#ms-name').value.trim(),
    host: $('#ms-host').value.trim(),
    port: $('#ms-port').value.trim(),
    user: $('#ms-user').value.trim(),
    password: $('#ms-password').value,
    database: $('#ms-database').value.trim(),
  };
  const conn = await window.api.mssqlConnect(cfg);
  if (conn && conn.error) {
    $('#ms-error').textContent = conn.error;
    return;
  }
  $('#mssql-modal').classList.add('hidden');
  addConnection(conn);
  saveRemoteConnection({ type: 'mssql', name: conn.name, host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database });
}

function runTestConnection(cfg, errSel) {
  const el = $(errSel);
  el.textContent = '测试中…';
  el.className = 'modal-error';
  window.api.testConnection(cfg).then((resp) => {
    if (resp && resp.ok) { el.textContent = '连接成功'; el.className = 'modal-error ok'; }
    else { el.textContent = (resp && resp.error) ? resp.error : '连接失败'; el.className = 'modal-error'; }
  });
}
function testMysql() {
  runTestConnection({ type: $('#m-flavor').value, host: $('#m-host').value.trim(), port: $('#m-port').value.trim(), user: $('#m-user').value.trim(), password: $('#m-password').value, database: $('#m-database').value.trim() }, '#m-error');
}
function testPg() {
  runTestConnection({ type: 'postgres', host: $('#pg-host').value.trim(), port: $('#pg-port').value.trim(), user: $('#pg-user').value.trim(), password: $('#pg-password').value, database: $('#pg-database').value.trim() }, '#pg-error');
}
function testMssql() {
  runTestConnection({ type: 'mssql', host: $('#ms-host').value.trim(), port: $('#ms-port').value.trim(), user: $('#ms-user').value.trim(), password: $('#ms-password').value, database: $('#ms-database').value.trim() }, '#ms-error');
}

async function useDatabase(connId, database) {
  const conn = connById(connId);
  let resp;
  if (conn && conn.type === 'postgres') resp = await window.api.pgUseDatabase(connId, database);
  else if (conn && conn.type === 'mssql') resp = await window.api.mssqlUseDatabase(connId, database);
  else resp = await window.api.mysqlUseDatabase(connId, database);
  if (resp && resp.ok) {
    const c = connById(connId);
    if (c) {
      c.name = resp.name;
      c.database = resp.database;
      c.tables = resp.tables;
      if (resp.databases) c.databases = resp.databases;
    }
    refreshConnSelect();
    buildTree();
    setStatus(resp.name, '');
  } else {
    setStatus('错误：' + (resp && resp.error ? resp.error : '切换失败'), '');
  }
}

function newConnection() {
  $('#conn-type-modal').classList.remove('hidden');
}

function showConnContextMenu(e, conn) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  if (isRemote(conn)) {
    const newDb = el('div', 'ctx-item', '新建数据库');
    newDb.addEventListener('click', () => { closeContextMenu(); openCreateDatabase(conn); });
    menu.appendChild(newDb);
  }
  if (!isRemote(conn)) {
    const newTable = el('div', 'ctx-item', '新建表');
    newTable.addEventListener('click', () => { closeContextMenu(); openTableDesigner(conn); });
    menu.appendChild(newTable);
    const qb = el('div', 'ctx-item', '查询构建器');
    qb.addEventListener('click', () => { closeContextMenu(); openQueryBuilder(conn); });
    menu.appendChild(qb);
  }
  const dup = el('div', 'ctx-item', '复制连接');
  dup.addEventListener('click', () => { closeContextMenu(); duplicateConnection(conn); });
  menu.appendChild(dup);
  if (isRemote(conn)) {
    const edit = el('div', 'ctx-item', '编辑连接');
    edit.addEventListener('click', () => { closeContextMenu(); editConnection(conn); });
    menu.appendChild(edit);
  }
  const refresh = el('div', 'ctx-item', '刷新');
  refresh.addEventListener('click', () => { closeContextMenu(); refreshConn(conn); });
  let monitor = null;
  if (isRemote(conn)) {
    monitor = el('div', 'ctx-item', '服务器监控');
    monitor.addEventListener('click', () => { closeContextMenu(); openServerInfoTab(conn.id); });
  }
  let userMgr = null;
  if (conn.type === 'mysql') {
    userMgr = el('div', 'ctx-item', '用户管理');
    userMgr.addEventListener('click', () => { closeContextMenu(); openUserManagerTab(conn.id); });
  }
  let scheduler = null;
  let er = null;
  if (!isRemote(conn)) {
    scheduler = el('div', 'ctx-item', '计划任务');
    scheduler.addEventListener('click', () => { closeContextMenu(); openSchedulerTab(conn.id); });
    er = el('div', 'ctx-item', 'ER 图');
    er.addEventListener('click', () => { closeContextMenu(); openErTab(conn.id); });
  }
  const backup = el('div', 'ctx-item', '备份为 SQL');
  backup.addEventListener('click', () => { closeContextMenu(); backupSql(conn); });
  const restore = el('div', 'ctx-item', '恢复 SQL 文件');
  restore.addEventListener('click', () => { closeContextMenu(); restoreSql(conn); });
  const rename = el('div', 'ctx-item', '重命名');
  rename.addEventListener('click', () => { closeContextMenu(); renameConnectionInline(conn); });
  const close = el('div', 'ctx-item danger', '关闭连接');
  close.addEventListener('click', () => { closeContextMenu(); closeConnection(conn.id); });
  menu.appendChild(refresh);
  if (monitor) menu.appendChild(monitor);
  if (userMgr) menu.appendChild(userMgr);
  if (scheduler) menu.appendChild(scheduler);
  if (er) menu.appendChild(er);
  menu.appendChild(backup);
  menu.appendChild(restore);
  menu.appendChild(rename);
  menu.appendChild(close);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

function closeContextMenu() {
  const m = document.querySelector('.ctx-menu');
  if (m) m.remove();
}

async function refreshConn(conn) {
  const tables = await window.api.tables(conn.id);
  conn.tables = tables;
  if (conn.type === 'mysql' || conn.type === 'postgres' || conn.type === 'mssql') {
    conn.databases = await window.api.databases(conn.id);
  }
  buildTree();
  loadTableCounts(conn);
  setStatus('已刷新', connSubtitle(conn));
}

function showTableContextMenu(e, conn, t) {
  if (t.type === 'database') return;
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const open = el('div', 'ctx-item', '打开表');
  open.addEventListener('click', () => { closeContextMenu(); state.activeId = conn.id; refreshConnSelect(); openTableTab(conn.id, t.name); });
  const rename = el('div', 'ctx-item', '重命名');
  rename.addEventListener('click', () => { closeContextMenu(); renameTable(conn, t); });
  const truncate = el('div', 'ctx-item danger', '清空表');
  truncate.addEventListener('click', () => { closeContextMenu(); truncateTable(conn, t); });
  const drop = el('div', 'ctx-item danger', '删除表');
  drop.addEventListener('click', () => { closeContextMenu(); dropTable(conn, t); });
  const dup = el('div', 'ctx-item', '复制表');
  dup.addEventListener('click', () => { closeContextMenu(); duplicateTable(conn, t); });
  const transfer = el('div', 'ctx-item', '数据传输');
  transfer.addEventListener('click', () => { closeContextMenu(); openDataTransfer(conn, t); });
  const compare = el('div', 'ctx-item', '结构对比');
  compare.addEventListener('click', () => { closeContextMenu(); openStructureCompare(conn, t); });
  const gen = el('div', 'ctx-item', '数据生成器');
  gen.addEventListener('click', () => { closeContextMenu(); openDataGenerator(conn, t); });
  const imp = el('div', 'ctx-item', '导入 CSV');
  imp.addEventListener('click', () => { closeContextMenu(); importCsv(conn, t); });
  const expJson = el('div', 'ctx-item', '导出 JSON');
  expJson.addEventListener('click', () => { closeContextMenu(); exportJson(conn, t); });
  const expSql = el('div', 'ctx-item', '导出 SQL');
  expSql.addEventListener('click', () => { closeContextMenu(); exportSql(conn, t); });
  const expExcel = el('div', 'ctx-item', '导出 Excel');
  expExcel.addEventListener('click', () => { closeContextMenu(); exportExcel(conn, t); });
  menu.appendChild(open);
  menu.appendChild(rename);
  menu.appendChild(dup);
  menu.appendChild(transfer);
  menu.appendChild(compare);
  menu.appendChild(gen);
  menu.appendChild(imp);
  menu.appendChild(expJson);
  menu.appendChild(expSql);
  menu.appendChild(expExcel);
  menu.appendChild(truncate);
  menu.appendChild(drop);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

async function truncateTable(conn, t) {
  if (!(await confirmModal('确定要清空表「' + t.name + '」的所有数据吗？此操作不可撤销。'))) return;
  const sql = (conn.type === 'mysql')
    ? 'TRUNCATE TABLE ' + qIdent(conn, t.name)
    : 'DELETE FROM ' + qIdent(conn, t.name);
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { setStatus('清空失败：' + resp.error, ''); return; }
  setStatus('已清空表 ' + t.name, '');
}

async function dropTable(conn, t) {
  if (!(await confirmModal('确定要删除表「' + t.name + '」吗？此操作不可撤销。'))) return;
  const sql = 'DROP TABLE ' + qIdent(conn, t.name);
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { setStatus('删除失败：' + resp.error, ''); return; }
  await refreshConn(conn);
  setStatus('已删除表 ' + t.name, '');
}

async function duplicateTable(conn, t) {
  const newName = await promptModal('复制表「' + t.name + '」为：', t.name + '_copy');
  if (!newName || !newName.trim()) return;
  const oldT = qIdent(conn, t.name);
  const newT = qIdent(conn, newName.trim());
  const sql = (conn.type === 'mssql')
    ? 'SELECT * INTO ' + newT + ' FROM ' + oldT
    : 'CREATE TABLE ' + newT + ' AS SELECT * FROM ' + oldT;
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { setStatus('复制失败：' + resp.error, ''); return; }
  await refreshConn(conn);
  setStatus('已复制为 ' + newName.trim(), '');
}

async function importCsv(conn, t) {
  const resp = await window.api.importCsv();
  if (!resp || resp.canceled) return;
  if (resp.error) { setStatus('导入失败：' + resp.error, ''); return; }
  const header = resp.header || [];
  const data = resp.data || [];
  if (!header.length) { setStatus('CSV 没有表头', ''); return; }
  if (!data.length) { setStatus('CSV 没有数据行', ''); return; }
  const tbl = qIdent(conn, t.name);
  const cols = header.map((h) => qIdent(conn, h));
  let inserted = 0;
  for (const row of data) {
    const vals = header.map((h, i) => (row[i] === undefined ? '' : row[i]));
    const sql = 'INSERT INTO ' + tbl + ' (' + cols.join(', ') + ') VALUES (' + header.map(() => '?').join(', ') + ')';
    const r = await window.api.execute(conn.id, sql, vals);
    if (r && r.error) { setStatus('导入失败：' + r.error, ''); return; }
    inserted++;
  }
  await refreshConn(conn);
  setStatus('已导入 ' + inserted + ' 行到 ' + t.name, '');
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function exportJson(conn, t) {
  const resp = await window.api.tableData(conn.id, t.name, 5000, 0);
  if (resp.error) { setStatus('导出失败：' + resp.error, ''); return; }
  const rows = resp.rows.map((r) => { const o = {}; resp.columns.forEach((c, i) => { o[c] = r[i]; }); return o; });
  const content = JSON.stringify(rows, null, 2);
  const save = await window.api.exportText({ content, defaultName: t.name + '.json', filters: [{ name: 'JSON 文件', extensions: ['json'] }] });
  if (save && save.ok) setStatus('已导出到 ' + save.path, '');
}

async function exportSql(conn, t) {
  const resp = await window.api.tableData(conn.id, t.name, 5000, 0);
  if (resp.error) { setStatus('导出失败：' + resp.error, ''); return; }
  const tbl = qIdent(conn, t.name);
  const cols = resp.columns.map((c) => qIdent(conn, c)).join(', ');
  const lines = resp.rows.map((r) => 'INSERT INTO ' + tbl + ' (' + cols + ') VALUES (' + r.map(sqlValue).join(', ') + ');');
  const content = lines.join('\n');
  const save = await window.api.exportText({ content, defaultName: t.name + '.sql', filters: [{ name: 'SQL 文件', extensions: ['sql'] }] });
  if (save && save.ok) setStatus('已导出到 ' + save.path, '');
}

async function exportExcel(conn, t) {
  const resp = await window.api.tableData(conn.id, t.name, 5000, 0);
  if (resp.error) { setStatus('导出失败：' + resp.error, ''); return; }
  const save = await window.api.exportExcel({ columns: resp.columns, rows: resp.rows, defaultName: t.name + '.xlsx' });
  if (save && save.ok) setStatus('已导出到 ' + save.path, '');
  else if (save && save.error) setStatus('导出失败：' + save.error, '');
}

async function loadTableCounts(conn) {
  const counts = await window.api.tableCounts(conn.id);
  conn.tableCounts = counts;
  buildTree();
}

let transferSrc = null;
function openDataTransfer(conn, t) {
  transferSrc = { conn, table: t.name };
  const dbSel = $('#tr-db');
  dbSel.innerHTML = '';
  if (conn.type === 'sqlite') {
    $('#tr-db-field').classList.add('hidden');
  } else {
    $('#tr-db-field').classList.remove('hidden');
    const dbs = conn.databases || [];
    dbs.forEach((db) => { const o = el('option', null, db.name); o.value = db.name; dbSel.appendChild(o); });
    if (conn.database) dbSel.value = conn.database;
  }
  $('#tr-table').value = t.name + '_copy';
  $('#tr-error').textContent = '';
  $('#transfer-modal').classList.remove('hidden');
}

async function submitDataTransfer() {
  const st = transferSrc;
  if (!st || !st.conn) return;
  const conn = st.conn;
  const targetDb = conn.type === 'sqlite' ? '' : $('#tr-db').value;
  const targetTable = $('#tr-table').value.trim();
  if (!targetTable) { $('#tr-error').textContent = '请输入目标表名'; return; }
  const mode = $('#tr-mode').value;
  const src = qualifiedTable(conn, conn.database, st.table);
  const dst = qualifiedTable(conn, targetDb, targetTable);
  let sql;
  if (mode === 'create') {
    sql = (conn.type === 'mssql')
      ? 'SELECT * INTO ' + dst + ' FROM ' + src
      : 'CREATE TABLE ' + dst + ' AS SELECT * FROM ' + src;
  } else {
    sql = 'INSERT INTO ' + dst + ' SELECT * FROM ' + src;
  }
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { $('#tr-error').textContent = resp.error; return; }
  $('#transfer-modal').classList.add('hidden');
  await refreshConn(conn);
  setStatus('已传输到 ' + targetTable, '');
}

let cmpSrc = null;
function openStructureCompare(conn, t) {
  cmpSrc = { conn, table: t.name };
  const sel = $('#cmp-table');
  sel.innerHTML = '';
  const tables = (conn.tables || []).filter((x) => x.type !== 'database' && x.name !== t.name);
  tables.forEach((x) => { const o = el('option', null, x.name); o.value = x.name; sel.appendChild(o); });
  $('#cmp-modal').classList.remove('hidden');
}

async function submitStructureCompare() {
  const st = cmpSrc;
  if (!st || !st.conn) return;
  const conn = st.conn;
  const target = $('#cmp-table').value;
  if (!target) { setStatus('请选择对比表', ''); return; }
  $('#cmp-modal').classList.add('hidden');
  const [a, b] = await Promise.all([
    window.api.tableInfo(conn.id, st.table),
    window.api.tableInfo(conn.id, target),
  ]);
  const colsA = (a && a.ok) ? a.columns : [];
  const colsB = (b && b.ok) ? b.columns : [];
  showStructureDiff(conn, st.table, target, colsA, colsB);
}

function showStructureDiff(conn, tableA, tableB, colsA, colsB) {
  const tab = makeTab('diff', '结构对比 ' + tableA + ' vs ' + tableB, conn.id, {});
  const bar = el('div', 'editor-toolbar');
  const syncBtn = el('button', 'tb', '同步 ' + tableA + ' 缺失字段到 ' + tableB);
  bar.appendChild(syncBtn);
  const meta = el('div', 'results-meta ok', '');
  const grid = el('div', 'results-grid');
  tab.el.appendChild(bar);
  tab.el.appendChild(meta);
  tab.el.appendChild(grid);
  activateTab(tab.id);
  const mapA = {}; colsA.forEach((c) => { mapA[c.name] = c; });
  const mapB = {}; colsB.forEach((c) => { mapB[c.name] = c; });
  const names = [...new Set([...colsA.map((c) => c.name), ...colsB.map((c) => c.name)])];
  const rows = [];
  names.forEach((n) => {
    const ca = mapA[n], cb = mapB[n];
    let diff;
    if (!ca) diff = '仅 ' + tableB + ' 有';
    else if (!cb) diff = '仅 ' + tableA + ' 有';
    else if (String(ca.type) !== String(cb.type)) diff = '类型不同';
    else if (!!ca.pk !== !!cb.pk) diff = '主键不同';
    else diff = '一致';
    rows.push([n, ca ? ca.type : '—', cb ? cb.type : '—', diff]);
  });
  const diffCount = rows.filter((r) => r[3] !== '一致').length;
  meta.textContent = '字段 ' + names.length + ' 个，差异 ' + diffCount + ' 处';
  renderGrid(grid, ['字段', tableA + ' 类型', tableB + ' 类型', '差异'], rows);
  syncBtn.addEventListener('click', async () => {
    const missing = colsA.filter((ca) => !mapB[ca.name]);
    if (!missing.length) { setStatus('没有需要同步的字段', ''); return; }
    const addKw = conn.type === 'mssql' ? 'ADD' : 'ADD COLUMN';
    let done = 0;
    for (const c of missing) {
      const sql = 'ALTER TABLE ' + qIdent(conn, tableB) + ' ' + addKw + ' ' + qIdent(conn, c.name) + ' ' + (c.type || 'TEXT');
      const r = await window.api.query(conn.id, sql);
      if (r && r.error) { setStatus('同步失败：' + r.error, ''); return; }
      done++;
    }
    setStatus('已同步 ' + done + ' 个字段到 ' + tableB, '');
  });
}

let genSrc = null;
function genValue(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('int') || t.includes('serial')) return String(Math.floor(Math.random() * 10000));
  if (t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('real') || t.includes('numeric')) return String((Math.random() * 1000).toFixed(2));
  if (t.includes('bool')) return String(Math.random() < 0.5 ? 1 : 0);
  if (t.includes('datetime') || t.includes('timestamp')) {
    const d = new Date(2000 + Math.floor(Math.random() * 25), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
    return "'" + d.toISOString().slice(0, 19).replace('T', ' ') + "'";
  }
  if (t.includes('date')) {
    const d = new Date(2000 + Math.floor(Math.random() * 25), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28));
    return "'" + d.toISOString().slice(0, 10) + "'";
  }
  return "'gen_" + Math.floor(Math.random() * 100000) + "'";
}
async function openDataGenerator(conn, t) {
  genSrc = { conn, table: t.name };
  const info = await window.api.tableInfo(conn.id, t.name);
  const cols = (info && info.ok) ? info.columns : [];
  genSrc.cols = cols;
  $('#gen-rows').value = '100';
  $('#gen-error').textContent = '';
  const list = $('#gen-cols');
  list.innerHTML = '';
  cols.forEach((c) => {
    const skip = (c.extra && String(c.extra).toLowerCase().includes('auto_increment')) ? '（自动增长，跳过）' : '';
    list.appendChild(el('div', 'gen-col', c.name + '  ' + c.type + '  ' + skip));
  });
  $('#gen-modal').classList.remove('hidden');
}
async function submitDataGenerator() {
  const st = genSrc;
  if (!st || !st.conn) return;
  const n = Math.max(1, Math.min(Number($('#gen-rows').value) || 100, 10000));
  const conn = st.conn;
  const tbl = qIdent(conn, st.table);
  const cols = (st.cols || []).filter((c) => !(c.extra && String(c.extra).toLowerCase().includes('auto_increment')));
  if (!cols.length) { setStatus('没有可生成的字段', ''); return; }
  const colList = cols.map((c) => qIdent(conn, c.name)).join(', ');
  let inserted = 0;
  for (let i = 0; i < n; i++) {
    const vals = cols.map((c) => genValue(c.type)).join(', ');
    const sql = 'INSERT INTO ' + tbl + ' (' + colList + ') VALUES (' + vals + ')';
    const r = await window.api.query(conn.id, sql);
    if (r && r.error) { setStatus('生成失败：' + r.error, ''); return; }
    inserted++;
  }
  $('#gen-modal').classList.add('hidden');
  await refreshConn(conn);
  setStatus('已生成 ' + inserted + ' 行数据到 ' + st.table, '');
}

let qbConnId = null;
async function openQueryBuilder(conn) {
  qbConnId = conn.id;
  const sel = $('#qb-table');
  sel.innerHTML = '';
  const tables = (conn.tables || []).filter((t) => t.type !== 'database');
  tables.forEach((t) => { const o = el('option', null, t.name); o.value = t.name; sel.appendChild(o); });
  $('#qb-where').value = '';
  $('#qb-order').value = '';
  $('#qb-limit').value = '100';
  $('#qb-error').textContent = '';
  $('#qb-modal').classList.remove('hidden');
  loadQbColumns(conn, sel.value);
}
async function loadQbColumns(conn, table) {
  const list = $('#qb-cols');
  list.innerHTML = '';
  if (!table) return;
  const info = await window.api.tableInfo(conn.id, table);
  const cols = (info && info.ok) ? info.columns : [];
  cols.forEach((c) => {
    const label = el('label', 'qb-col');
    const cb = el('input'); cb.type = 'checkbox'; cb.value = c.name; cb.checked = true;
    label.appendChild(cb);
    label.appendChild(el('span', null, c.name + ' (' + c.type + ')'));
    list.appendChild(label);
  });
}
function submitQueryBuilder() {
  const conn = connById(qbConnId);
  if (!conn) return;
  const table = $('#qb-table').value;
  if (!table) { $('#qb-error').textContent = '请选择表'; return; }
  const checked = [...$('#qb-cols').querySelectorAll('input[type=checkbox]:checked')].map((cb) => cb.value);
  if (!checked.length) { $('#qb-error').textContent = '请至少选择一个字段'; return; }
  const cols = checked.map((c) => qIdent(conn, c)).join(', ');
  const tbl = qualifiedTable(conn, conn.database, table);
  let sql = 'SELECT ' + cols + '\nFROM ' + tbl;
  const where = $('#qb-where').value.trim();
  if (where) sql += '\nWHERE ' + where;
  const order = $('#qb-order').value.trim();
  if (order) sql += '\nORDER BY ' + order;
  const limit = $('#qb-limit').value.trim();
  if (limit) sql += '\nLIMIT ' + limit;
  $('#qb-modal').classList.add('hidden');
  const tab = openQueryTab(conn.id);
  tab.editor.value = sql;
  tab.editor.dispatchEvent(new Event('input'));
}

let createUserConnId = null;
let createUserDone = null;
function openUserManagerTab(connId) {
  const conn = connById(connId);
  if (!conn) return;
  const tab = makeTab('users', '用户管理 ' + (conn.name || ''), connId, {});
  const bar = el('div', 'editor-toolbar');
  const newBtn = el('button', 'tb', '＋ 新建用户');
  const refreshBtn = el('button', 'tb', '刷新');
  bar.appendChild(newBtn);
  bar.appendChild(refreshBtn);
  const meta = el('div', 'results-meta', '加载中…');
  const grid = el('div', 'results-grid');
  tab.el.appendChild(bar);
  tab.el.appendChild(meta);
  tab.el.appendChild(grid);
  tab.userMeta = meta;
  tab.userGrid = grid;
  activateTab(tab.id);
  newBtn.addEventListener('click', () => openCreateUser(connId, () => refreshUserList(tab)));
  refreshBtn.addEventListener('click', () => refreshUserList(tab));
  refreshUserList(tab);
  return tab;
}
async function refreshUserList(tab) {
  const resp = await window.api.listUsers(tab.connId);
  if (resp && resp.error) { tab.userMeta.className = 'results-meta err'; tab.userMeta.textContent = '错误：' + resp.error; return; }
  const users = (resp && resp.users) || [];
  tab.userMeta.className = 'results-meta ok';
  tab.userMeta.textContent = '共 ' + users.length + ' 个用户';
  const wrap = tab.userGrid;
  wrap.innerHTML = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  ['用户', '主机', '操作'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  users.forEach((u) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, u.User));
    tr.appendChild(el('td', null, u.Host));
    const td = el('td');
    const del = el('button', 'tb', '删除');
    del.addEventListener('click', async () => {
      if (!(await confirmModal('确定删除用户 ' + u.User + '@' + u.Host + ' 吗？'))) return;
      const r = await window.api.dropUser(tab.connId, u.User, u.Host);
      if (r && r.error) setStatus('删除失败：' + r.error, '');
      else { setStatus('已删除用户 ' + u.User, ''); refreshUserList(tab); }
    });
    td.appendChild(del);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}
function openCreateUser(connId, onDone) {
  createUserConnId = connId;
  createUserDone = onDone;
  $('#cu-user').value = '';
  $('#cu-host').value = '%';
  $('#cu-password').value = '';
  $('#cu-error').textContent = '';
  $('#cu-modal').classList.remove('hidden');
  $('#cu-user').focus();
}
async function submitCreateUser() {
  const user = $('#cu-user').value.trim();
  const host = $('#cu-host').value.trim() || '%';
  const password = $('#cu-password').value;
  if (!user) { $('#cu-error').textContent = '请输入用户名'; return; }
  const resp = await window.api.createUser(createUserConnId, { user, host, password });
  if (resp && resp.error) { $('#cu-error').textContent = resp.error; return; }
  $('#cu-modal').classList.add('hidden');
  setStatus('已创建用户 ' + user + '@' + host, '');
  if (createUserDone) createUserDone();
}

const TASKS_KEY = 'scheduledTasks';
function loadTasks() { try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch (e) { return []; } }
function saveTasks(list) { try { localStorage.setItem(TASKS_KEY, JSON.stringify(list)); } catch (e) {} }
let taskConnId = null;
function openSchedulerTab(connId) {
  const tab = makeTab('tasks', '计划任务', connId, {});
  const bar = el('div', 'editor-toolbar');
  const newBtn = el('button', 'tb', '＋ 新建任务');
  const refreshBtn = el('button', 'tb', '刷新');
  bar.appendChild(newBtn);
  bar.appendChild(refreshBtn);
  const meta = el('div', 'results-meta', '');
  const grid = el('div', 'results-grid');
  tab.el.appendChild(bar);
  tab.el.appendChild(meta);
  tab.el.appendChild(grid);
  tab.taskMeta = meta;
  tab.taskGrid = grid;
  activateTab(tab.id);
  newBtn.addEventListener('click', () => openNewTask(connId, () => renderTasks(tab)));
  refreshBtn.addEventListener('click', () => renderTasks(tab));
  renderTasks(tab);
  return tab;
}
function renderTasks(tab) {
  const list = loadTasks().filter((t) => t.connId === tab.connId);
  tab.taskMeta.className = 'results-meta ok';
  tab.taskMeta.textContent = '共 ' + list.length + ' 个任务（应用运行期间按间隔自动执行）';
  const wrap = tab.taskGrid;
  wrap.innerHTML = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  ['任务名', '间隔(分)', '上次运行', '结果', '操作'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  list.forEach((t) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, t.name));
    tr.appendChild(el('td', null, String(t.interval)));
    tr.appendChild(el('td', null, t.lastRun ? new Date(t.lastRun).toLocaleString() : '—'));
    tr.appendChild(el('td', null, t.lastResult || '—'));
    const td = el('td');
    const runBtn = el('button', 'tb', '执行');
    runBtn.addEventListener('click', async () => {
      const resp = await window.api.query(t.connId, t.sql);
      t.lastRun = Date.now();
      t.lastResult = (resp && resp.error) ? '错误' : '成功';
      saveTasks(list);
      renderTasks(tab);
      setStatus('任务「' + t.name + '」执行' + (t.lastResult === '成功' ? '成功' : '失败'), '');
    });
    const delBtn = el('button', 'tb', '删除');
    delBtn.addEventListener('click', async () => {
      if (!(await confirmModal('删除任务 ' + t.name + '？'))) return;
      saveTasks(loadTasks().filter((x) => !(x.name === t.name && x.connId === t.connId)));
      renderTasks(tab);
    });
    td.appendChild(runBtn);
    td.appendChild(delBtn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}
function openNewTask(connId, onDone) {
  taskConnId = connId;
  $('#task-name').value = '';
  $('#task-interval').value = '10';
  $('#task-sql').value = '';
  $('#task-error').textContent = '';
  $('#task-modal').classList.remove('hidden');
}
function submitNewTask() {
  const name = $('#task-name').value.trim();
  const sql = $('#task-sql').value.trim();
  const interval = Math.max(1, Number($('#task-interval').value) || 10);
  if (!name) { $('#task-error').textContent = '请输入任务名'; return; }
  if (!sql) { $('#task-error').textContent = '请输入 SQL'; return; }
  const list = loadTasks().filter((t) => !(t.name === name && t.connId === taskConnId));
  list.push({ name, sql, interval, connId: taskConnId, lastRun: null, lastResult: null });
  saveTasks(list);
  $('#task-modal').classList.add('hidden');
  setStatus('已保存任务 ' + name, '');
}

async function openErTab(connId) {
  const conn = connById(connId);
  if (!conn) return;
  const tab = makeTab('er', 'ER 图 ' + (conn.name || ''), connId, {});
  const meta = el('div', 'results-meta', '加载中…');
  const wrap = el('div', 'er-wrap');
  tab.el.appendChild(meta);
  tab.el.appendChild(wrap);
  activateTab(tab.id);
  const tables = (conn.tables || []).filter((t) => t.type === 'table');
  const fks = (await window.api.foreignKeys(conn.id)) || [];
  const colMap = {};
  await Promise.all(tables.map(async (t) => {
    const info = await window.api.tableInfo(conn.id, t.name);
    colMap[t.name] = (info && info.ok) ? info.columns.map((c) => c.name) : [];
  }));
  meta.className = 'results-meta ok';
  meta.textContent = '表 ' + tables.length + ' 个，外键关系 ' + fks.length + ' 个';
  renderErDiagram(wrap, tables.map((t) => ({ name: t.name, cols: colMap[t.name] || [] })), fks);
}

function renderErDiagram(wrap, tables, fks) {
  wrap.innerHTML = '';
  const boxes = {};
  const stage = el('div', 'er-stage');
  const grid = el('div', 'er-grid');
  tables.forEach((t) => {
    const box = el('div', 'er-box');
    box.appendChild(el('div', 'er-box-title', t.name));
    const colsEl = el('div', 'er-box-cols');
    t.cols.slice(0, 15).forEach((c) => colsEl.appendChild(el('div', null, c)));
    box.appendChild(colsEl);
    grid.appendChild(box);
    boxes[t.name] = box;
  });
  stage.appendChild(grid);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'er-svg');
  stage.appendChild(svg);
  wrap.appendChild(stage);
  setTimeout(() => {
    const sr = stage.getBoundingClientRect();
    svg.setAttribute('width', sr.width);
    svg.setAttribute('height', sr.height);
    fks.forEach((fk) => {
      const a = boxes[fk.table], b = boxes[fk.refTable];
      if (!a || !b) return;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.left - sr.left + ra.width / 2, y1 = ra.top - sr.top + ra.height / 2;
      const x2 = rb.left - sr.left + rb.width / 2, y2 = rb.top - sr.top + rb.height / 2;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#2f7fd0');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '5 3');
      line.setAttribute('opacity', '0.5');
      svg.appendChild(line);
    });
  }, 80);
  if (fks.length) {
    const rel = el('div', 'er-rels');
    rel.appendChild(el('div', 'ti-head', '关系'));
    fks.forEach((fk) => rel.appendChild(el('div', 'er-rel', fk.table + '.' + fk.column + ' → ' + fk.refTable + '.' + fk.refColumn)));
    wrap.appendChild(rel);
  }
}

function backupSql(conn) {
  window.api.dumpSql(conn.id).then((resp) => {
    if (resp && resp.canceled) return;
    if (resp && resp.ok) setStatus('已备份到 ' + resp.path, '');
    else setStatus('备份失败：' + ((resp && resp.error) || ''), '');
  });
}

function restoreSql(conn) {
  window.api.runSqlFile(conn.id).then((resp) => {
    if (resp && resp.canceled) return;
    if (resp && resp.ok) { setStatus('恢复完成', ''); refreshConn(conn); }
    else setStatus('恢复失败：' + ((resp && resp.error) || ''), '');
  });
}

function showDatabaseContextMenu(e, conn, t) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const dbAct = (fn) => {
    closeContextMenu();
    if (conn.database === t.name) fn();
    else useDatabase(conn.id, t.name).then(() => fn());
  };
  const open = el('div', 'ctx-item', '打开数据库');
  open.addEventListener('click', () => { closeContextMenu(); useDatabase(conn.id, t.name); });
  const newTable = el('div', 'ctx-item', '新建表');
  newTable.addEventListener('click', () => dbAct(() => openTableDesigner(conn)));
  const qb = el('div', 'ctx-item', '查询构建器');
  qb.addEventListener('click', () => dbAct(() => openQueryBuilder(conn)));
  const scheduler = el('div', 'ctx-item', '计划任务');
  scheduler.addEventListener('click', () => dbAct(() => openSchedulerTab(conn.id)));
  const er = el('div', 'ctx-item', 'ER 图');
  er.addEventListener('click', () => dbAct(() => openErTab(conn.id)));
  const edit = el('div', 'ctx-item', '编辑数据库');
  edit.addEventListener('click', () => { closeContextMenu(); openEditDatabase(conn, t.name); });
  const drop = el('div', 'ctx-item danger', '删除数据库');
  drop.addEventListener('click', () => { closeContextMenu(); dropDatabase(conn, t.name); });
  menu.appendChild(open);
  menu.appendChild(newTable);
  menu.appendChild(qb);
  menu.appendChild(scheduler);
  menu.appendChild(er);
  menu.appendChild(edit);
  menu.appendChild(drop);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

async function renameTable(conn, t) {
  const newName = await promptModal('重命名表「' + t.name + '」为：', t.name);
  if (!newName || newName.trim() === t.name) return;
  let sql;
  if (conn.type === 'mysql') sql = 'RENAME TABLE ' + qIdent(conn, t.name) + ' TO ' + qIdent(conn, newName.trim());
  else if (conn.type === 'mssql') sql = "EXEC sp_rename '" + t.name.replace(/'/g, "''") + "', '" + newName.trim().replace(/'/g, "''") + "'";
  else sql = 'ALTER TABLE ' + qIdent(conn, t.name) + ' RENAME TO ' + qIdent(conn, newName.trim());
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { setStatus('重命名失败：' + resp.error, ''); return; }
  await refreshConn(conn);
  setStatus('已重命名为 ' + newName.trim(), '');
}

let createDbConnId = null;
let editDbName = null;
const MYSQL_CHARSETS = ['utf8mb4', 'utf8', 'gbk', 'latin1'];
const MYSQL_COLLATES = ['', 'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8_general_ci', 'gbk_chinese_ci', 'latin1_swedish_ci'];
const PG_ENCODINGS = ['UTF8', 'LATIN1', 'WIN1252', 'GBK', 'SQL_ASCII'];

function populateDbOptions(conn) {
  const charsetSel = $('#db-charset');
  const collateSel = $('#db-collate');
  charsetSel.innerHTML = '';
  collateSel.innerHTML = '';
  $('#db-charset-field').classList.remove('hidden');
  $('#db-collate-field').classList.remove('hidden');
  if (conn.type === 'mysql') {
    MYSQL_CHARSETS.forEach((c) => { const o = el('option', null, c); o.value = c; charsetSel.appendChild(o); });
    MYSQL_COLLATES.forEach((c) => { const o = el('option', null, c === '' ? '（默认）' : c); o.value = c; collateSel.appendChild(o); });
  } else if (conn.type === 'postgres') {
    PG_ENCODINGS.forEach((c) => { const o = el('option', null, c); o.value = c; charsetSel.appendChild(o); });
    $('#db-collate-field').classList.add('hidden');
  } else {
    $('#db-charset-field').classList.add('hidden');
    $('#db-collate-field').classList.add('hidden');
  }
}

function openCreateDatabase(conn) {
  createDbConnId = conn.id;
  editDbName = null;
  $('#db-title').textContent = '新建数据库';
  $('#db-name').value = '';
  $('#db-name').readOnly = false;
  $('#db-error').textContent = '';
  populateDbOptions(conn);
  $('#db-modal').classList.remove('hidden');
  $('#db-name').focus();
}

function openEditDatabase(conn, dbName) {
  createDbConnId = conn.id;
  editDbName = dbName;
  $('#db-title').textContent = '编辑数据库：' + dbName;
  $('#db-name').value = dbName;
  $('#db-error').textContent = '';
  populateDbOptions(conn);
  if (conn.type === 'mysql') {
    $('#db-name').readOnly = true;
    $('#db-name').title = 'MySQL 不支持重命名数据库，可修改字符集/排序规则';
  } else {
    $('#db-name').readOnly = false;
    $('#db-charset-field').classList.add('hidden');
    $('#db-collate-field').classList.add('hidden');
  }
  $('#db-modal').classList.remove('hidden');
  $('#db-name').focus();
}

function buildCreateDatabaseSql(conn, name, charset, collate) {
  if (conn.type === 'mysql') {
    let sql = 'CREATE DATABASE ' + qIdent(conn, name);
    if (charset) sql += ' CHARACTER SET ' + charset;
    if (collate) sql += ' COLLATE ' + collate;
    return sql;
  }
  if (conn.type === 'postgres') {
    let sql = 'CREATE DATABASE ' + qIdent(conn, name);
    if (charset) sql += " ENCODING '" + String(charset).replace(/'/g, "''") + "'";
    return sql;
  }
  return 'CREATE DATABASE ' + qIdent(conn, name);
}

function buildEditDatabaseSql(conn, newName, charset, collate) {
  if (conn.type === 'mysql') {
    let sql = 'ALTER DATABASE ' + qIdent(conn, editDbName);
    if (charset) sql += ' CHARACTER SET ' + charset;
    if (collate) sql += ' COLLATE ' + collate;
    return sql;
  }
  if (conn.type === 'postgres' && newName && newName !== editDbName) {
    return 'ALTER DATABASE ' + qIdent(conn, editDbName) + ' RENAME TO ' + qIdent(conn, newName);
  }
  if (conn.type === 'mssql' && newName && newName !== editDbName) {
    return 'ALTER DATABASE ' + qIdent(conn, editDbName) + ' MODIFY NAME = ' + qIdent(conn, newName);
  }
  return '';
}

async function submitCreateDatabase() {
  const conn = connById(createDbConnId);
  if (!conn) return;
  const name = $('#db-name').value.trim();
  const charset = $('#db-charset').value;
  const collate = $('#db-collate').value;
  let sql;
  if (editDbName) {
    sql = buildEditDatabaseSql(conn, name, charset, collate);
    if (!sql) { $('#db-error').textContent = '没有需要修改的内容'; return; }
  } else {
    if (!name) { $('#db-error').textContent = '请输入数据库名称'; return; }
    sql = buildCreateDatabaseSql(conn, name, charset, collate);
  }
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { $('#db-error').textContent = resp.error; return; }
  $('#db-modal').classList.add('hidden');
  await refreshConn(conn);
  setStatus(editDbName ? '已修改数据库 ' + editDbName : '已创建数据库 ' + name, '');
}

async function dropDatabase(conn, dbName) {
  if (!(await confirmModal('确定要删除数据库「' + dbName + '」吗？此操作不可撤销。'))) return;
  const resp = await window.api.query(conn.id, 'DROP DATABASE ' + qIdent(conn, dbName));
  if (resp && resp.error) { setStatus('删除失败：' + resp.error, ''); return; }
  await refreshConn(conn);
  setStatus('已删除数据库 ' + dbName, '');
}

function findSavedRemoteConfig(conn) {
  try {
    const list = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    const type = conn.type === 'mysql' ? (conn.flavor === 'mariadb' ? 'mariadb' : 'mysql') : conn.type;
    return list.find((c) => c.type === type && c.host === conn.host && String(c.port) === String(conn.port) && c.database === conn.database) || null;
  } catch (e) { return null; }
}

function editConnection(conn) {
  if (conn.type === 'postgres') {
    $('#pg-name').value = conn.name || '';
    $('#pg-host').value = conn.host || '';
    $('#pg-port').value = String(conn.port || 5432);
    $('#pg-user').value = conn.user || '';
    $('#pg-password').value = '';
    $('#pg-database').value = conn.database || '';
    $('#pg-error').textContent = '';
    $('#pg-modal').classList.remove('hidden');
    $('#pg-host').focus();
    return;
  }
  if (conn.type === 'mssql') {
    $('#ms-name').value = conn.name || '';
    $('#ms-host').value = conn.host || '';
    $('#ms-port').value = String(conn.port || 1433);
    $('#ms-user').value = conn.user || '';
    $('#ms-password').value = '';
    $('#ms-database').value = conn.database || '';
    $('#ms-error').textContent = '';
    $('#mssql-modal').classList.remove('hidden');
    $('#ms-host').focus();
    return;
  }
  if (conn.type !== 'mysql') { setStatus('SQLite 连接可直接重命名', ''); return; }
  $('#m-flavor').value = conn.flavor === 'mariadb' ? 'mariadb' : 'mysql';
  $('#m-name').value = conn.name || '';
  $('#m-host').value = conn.host || '';
  $('#m-port').value = String(conn.port || 3306);
  $('#m-user').value = conn.user || '';
  $('#m-password').value = '';
  $('#m-database').value = conn.database || '';
  $('#m-error').textContent = '';
  $('#mysql-modal').classList.remove('hidden');
  $('#m-host').focus();
}

async function duplicateConnection(conn) {
  if (conn.type === 'sqlite') {
    await openPath(conn.path);
    return;
  }
  const cfg = findSavedRemoteConfig(conn);
  if (!cfg) { editConnection(conn); return; }
  await reconnectRemote(cfg);
}

function renameConnectionInline(conn) {
  const span = conn._nameSpan;
  if (!span || !span.isConnected) return;
  const input = el('input', 'rename-input');
  input.value = conn.name;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const v = input.value.trim();
      if (v) { conn.name = v; refreshConnSelect(); }
    }
    buildTree();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

function initSidebarResizer() {
  const resizer = $('#sidebar-resizer');
  const sidebar = $('#sidebar');
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(180, Math.min(500, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; resizer.classList.remove('dragging'); }
  });
}

let designerConnId = null;

function openTableDesigner(conn) {
  designerConnId = conn.id;
  $('#td-name').value = '';
  $('#td-error').textContent = '';
  const cols = $('#td-columns');
  cols.innerHTML = '';
  addDesignerRow({ name: 'id', type: (conn.type === 'mysql' ? 'INT' : 'INTEGER'), pk: true, notnull: true, dflt: '' });
  $('#table-designer-modal').classList.remove('hidden');
  $('#td-name').focus();
}

function addDesignerRow(col) {
  const cols = $('#td-columns');
  const row = el('div', 'designer-row');
  const name = el('input', 'dr-name'); name.type = 'text'; name.value = col.name || ''; name.placeholder = '字段名';
  const type = el('input', 'dr-type'); type.type = 'text'; type.value = col.type || ''; type.placeholder = '类型'; type.setAttribute('list', 'type-list');
  const pk = el('input', 'dr-pk'); pk.type = 'checkbox'; pk.checked = !!col.pk;
  const nn = el('input', 'dr-nn'); nn.type = 'checkbox'; nn.checked = !!col.notnull;
  const dflt = el('input', 'dr-dflt'); dflt.type = 'text'; dflt.value = col.dflt || ''; dflt.placeholder = '默认值';
  const del = el('button', 'row-del dr-del', '×'); del.title = '删除该字段';
  del.addEventListener('click', () => row.remove());
  row.appendChild(name); row.appendChild(type); row.appendChild(pk); row.appendChild(nn); row.appendChild(dflt); row.appendChild(del);
  cols.appendChild(row);
}

function collectDesignerColumns() {
  return [...$('#td-columns').querySelectorAll('.designer-row')].map((row) => ({
    name: row.querySelector('.dr-name').value.trim(),
    type: row.querySelector('.dr-type').value.trim(),
    pk: row.querySelector('.dr-pk').checked,
    notnull: row.querySelector('.dr-nn').checked,
    dflt: row.querySelector('.dr-dflt').value.trim(),
  }));
}

function buildCreateTableSQL(conn, name, cols) {
  const valid = cols.filter((c) => c.name);
  const pkCols = valid.filter((c) => c.pk).map((c) => c.name);
  const defs = valid.map((c) => {
    let def = qIdent(conn, c.name) + ' ' + (c.type || 'TEXT');
    if (c.notnull) def += ' NOT NULL';
    if (c.dflt) def += ' DEFAULT ' + c.dflt;
    if (c.pk && pkCols.length === 1) def += ' PRIMARY KEY';
    return def;
  });
  if (pkCols.length > 1) defs.push('PRIMARY KEY (' + pkCols.map((c) => qIdent(conn, c)).join(', ') + ')');
  return 'CREATE TABLE ' + qIdent(conn, name) + ' (' + defs.join(', ') + ')';
}

async function createTable() {
  const conn = connById(designerConnId);
  if (!conn) return;
  const name = $('#td-name').value.trim();
  if (!name) { $('#td-error').textContent = '请输入表名'; return; }
  const cols = collectDesignerColumns();
  if (!cols.some((c) => c.name)) { $('#td-error').textContent = '请至少定义一个字段'; return; }
  const sql = buildCreateTableSQL(conn, name, cols);
  const resp = await window.api.query(conn.id, sql);
  if (resp && resp.error) { $('#td-error').textContent = resp.error; return; }
  $('#table-designer-modal').classList.add('hidden');
  await refreshConn(conn);
  setStatus('已创建表 ' + name, '');
}

/* ================= init ================= */

function init() {
  // welcome pane
  welcomeEl = welcomePane();
  $('#tabcontent').appendChild(welcomeEl);

  $('#btn-new-conn').addEventListener('click', newConnection);
  $('#btn-new-conn-top').addEventListener('click', newConnection);
  $('#ct-sqlite-open').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); openFile(); });
  $('#ct-sqlite-new').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); createFile(); });
  $('#ct-mysql').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); mysqlConnect(); });
  $('#ct-pg').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); pgConnect(); });
  $('#ct-mssql').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); mssqlConnect(); });
  $('#ct-cancel').addEventListener('click', () => $('#conn-type-modal').classList.add('hidden'));
  $('#m-connect').addEventListener('click', submitMysqlConnect);
  $('#m-cancel').addEventListener('click', () => $('#mysql-modal').classList.add('hidden'));
  $('#m-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMysqlConnect(); });
  $('#pg-connect').addEventListener('click', submitPgConnect);
  $('#pg-cancel').addEventListener('click', () => $('#pg-modal').classList.add('hidden'));
  $('#pg-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPgConnect(); });
  $('#ms-connect').addEventListener('click', submitMssqlConnect);
  $('#ms-cancel').addEventListener('click', () => $('#mssql-modal').classList.add('hidden'));
  $('#ms-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMssqlConnect(); });
  $('#m-test').addEventListener('click', testMysql);
  $('#pg-test').addEventListener('click', testPg);
  $('#ms-test').addEventListener('click', testMssql);
  $('#db-ok').addEventListener('click', submitCreateDatabase);
  $('#db-cancel').addEventListener('click', () => $('#db-modal').classList.add('hidden'));
  $('#db-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCreateDatabase(); });
  $('#tr-ok').addEventListener('click', submitDataTransfer);
  $('#tr-cancel').addEventListener('click', () => $('#transfer-modal').classList.add('hidden'));
  $('#cmp-ok').addEventListener('click', submitStructureCompare);
  $('#cmp-cancel').addEventListener('click', () => $('#cmp-modal').classList.add('hidden'));
  $('#gen-ok').addEventListener('click', submitDataGenerator);
  $('#gen-cancel').addEventListener('click', () => $('#gen-modal').classList.add('hidden'));
  $('#cu-ok').addEventListener('click', submitCreateUser);
  $('#cu-cancel').addEventListener('click', () => $('#cu-modal').classList.add('hidden'));
  $('#qb-ok').addEventListener('click', submitQueryBuilder);
  $('#qb-cancel').addEventListener('click', () => $('#qb-modal').classList.add('hidden'));
  $('#qb-table').addEventListener('change', () => { const c = connById(qbConnId); if (c) loadQbColumns(c, $('#qb-table').value); });
  $('#task-ok').addEventListener('click', submitNewTask);
  $('#task-cancel').addEventListener('click', () => $('#task-modal').classList.add('hidden'));
  setInterval(() => {
    const now = Date.now();
    const list = loadTasks();
    list.forEach((t) => {
      if (t.lastRun && now - t.lastRun < t.interval * 60000) return;
      if (!connById(t.connId)) return;
      t.lastRun = now;
      saveTasks(list);
      window.api.query(t.connId, t.sql).then((resp) => {
        t.lastResult = (resp && resp.error) ? '错误' : '成功';
        saveTasks(list);
      });
    });
  }, 30000);
  $('#td-add-col').addEventListener('click', () => addDesignerRow({}));
  $('#td-create').addEventListener('click', createTable);
  $('#td-cancel').addEventListener('click', () => $('#table-designer-modal').classList.add('hidden'));
  $('#btn-save').addEventListener('click', saveActive);
  $('#btn-query').addEventListener('click', () => {
    if (!state.activeId) { setStatus('请先打开一个数据库连接', ''); return; }
    openQueryTab(state.activeId);
  });
  $('#conn-select').addEventListener('change', (e) => {
    state.activeId = Number(e.target.value) || null;
    refreshConnSelect();
    const c = activeConn();
    setStatus(c ? c.name : '', c ? connSubtitle(c) : '');
  });

  refreshConnSelect();
  buildTree();
  initSidebarResizer();
  document.addEventListener('mousedown', (e) => { if (acBox && !acBox.contains(e.target)) closeAutocomplete(); if (histBox && !histBox.contains(e.target)) closeQueryHistory(); if (snipBox && !snipBox.contains(e.target)) closeSnippets(); });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); newConnection(); }
    else if (k === 'q') { e.preventDefault(); if (state.activeId) openQueryTab(state.activeId); }
    else if (k === 's') { e.preventDefault(); saveActive(); }
    else if (k === 'f4') { e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); }
  });
  setStatus('就绪', '完全本地运行');
}

init();
