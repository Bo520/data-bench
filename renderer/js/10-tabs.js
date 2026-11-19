// ===== DataBench renderer: tab management & grids =====
'use strict';
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