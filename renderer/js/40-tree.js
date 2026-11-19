// ===== DataBench renderer: connection tree & groups =====
'use strict';
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

function renderConnectionNode(conn) {
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
  makeDraggable(head, connServerKey(conn));

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
  return group;
}

function renderSavedConnRow(cfg) {
  const key = remoteCfgKey(cfg);
  const row = el('div', 'tree-item closed');
  row.appendChild(el('span', 'ico', savedTypeIcon[cfg.type] || '🗄'));
  row.appendChild(el('span', null, cleanSavedName(cfg)));
  row.title = '点击连接';
  row.addEventListener('click', () => reconnectRemote(cfg));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showClosedConnContextMenu(e, key); });
  makeDraggable(row, key);
  return row;
}

function renderRecentFileRow(path) {
  const key = 'sqlite:' + path;
  const row = el('div', 'tree-item closed');
  row.appendChild(el('span', 'ico', '🗄'));
  row.appendChild(el('span', null, String(path).split(/[\\/]/).pop()));
  row.title = path;
  row.addEventListener('click', () => openPath(path));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showClosedConnContextMenu(e, key); });
  makeDraggable(row, key);
  return row;
}

function renderEntry(en) {
  if (en.conn) return renderConnectionNode(en.conn);
  if (en.cfg) return renderSavedConnRow(en.cfg);
  return renderRecentFileRow(en.path);
}

function renderGroupFolder(g, members) {
  const folder = el('div', 'tree-folder');
  const head = el('div', 'tree-folder-head');
  const caret = el('span', 'caret open', '▶');
  head.appendChild(caret);
  head.appendChild(el('span', 'ico', '📁'));
  head.appendChild(el('span', null, g.name));
  const fc = el('div', 'tree-folder-items');
  members.forEach((en) => fc.appendChild(renderEntry(en)));
  if (!members.length) fc.appendChild(el('div', 'tree-empty', '（空）'));
  head.addEventListener('click', () => {
    const collapsed = fc.classList.toggle('collapsed');
    caret.classList.toggle('open', !collapsed);
  });
  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupContextMenu(e, g);
  });
  head.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); head.classList.add('drop-hover'); });
  head.addEventListener('dragleave', () => head.classList.remove('drop-hover'));
  head.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    head.classList.remove('drop-hover');
    const key = e.dataTransfer.getData('text/plain');
    if (key) { setGroupOfKey(key, g.id); buildTree(); }
  });
  folder.appendChild(head);
  folder.appendChild(fc);
  return folder;
}

async function buildTree() {
  const tree = $('#tree');
  tree.innerHTML = '';
  const seen = new Set();
  const entries = [];

  state.connections.forEach((conn) => {
    const key = connServerKey(conn);
    seen.add(key);
    entries.push({ key, conn });
  });

  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('savedConnections') || '[]'); } catch (e) { /* ignore */ }
  saved.forEach((cfg) => {
    const key = remoteCfgKey(cfg);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ key, cfg });
  });

  try {
    const recent = await window.api.recent();
    (recent || []).forEach((p) => {
      const key = 'sqlite:' + p;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ key, path: p });
    });
  } catch (e) { /* ignore */ }

  const groups = loadGroups();
  const groupMap = loadGroupMap();
  const byGroup = new Map();
  const ungrouped = [];
  entries.forEach((en) => {
    const gid = groupMap[en.key] || '';
    if (gid && groups.some((g) => g.id === gid)) {
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(en);
    } else {
      ungrouped.push(en);
    }
  });

  groups.forEach((g) => tree.appendChild(renderGroupFolder(g, byGroup.get(g.id) || [])));
  ungrouped.forEach((en) => tree.appendChild(renderEntry(en)));

  if (!tree.children.length) tree.appendChild(el('div', 'tree-empty', '（无连接）'));
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

async function reconnectRemote(cfg) {
  const cleanCfg = { ...cfg, name: cleanSavedName(cfg) };
  let conn;
  if (cleanCfg.type === 'postgres') conn = await window.api.pgConnect(cleanCfg);
  else if (cleanCfg.type === 'mssql') conn = await window.api.mssqlConnect(cleanCfg);
  else conn = await window.api.mysqlConnect({ ...cleanCfg, flavor: cleanCfg.type === 'mariadb' ? 'mariadb' : 'mysql' });
  if (conn && conn.error) { setStatus('连接失败：' + conn.error, ''); return; }
  addConnection(conn);
}

/* ================= connection management ================= */

function addConnection(conn) {
  if (!conn || conn.error) {
    if (conn && conn.error) setStatus('错误：' + conn.error, '');
    return;
  }
  const key = connServerKey(conn);
  const dup = state.connections.find((c) => c.id !== conn.id && connServerKey(c) === key);
  if (dup) {
    window.api.close(conn.id);
    state.activeId = dup.id;
    refreshConnSelect();
    buildTree();
    setStatus(dup.name + '（已连接，复用现有连接）', connSubtitle(dup));
    return;
  }
  const existing = state.connections.findIndex((c) => c.id === conn.id);
  if (existing >= 0) state.connections[existing] = conn;
  else state.connections.push(conn);
  state.activeId = conn.id;
  refreshConnSelect();
  buildTree();
  loadTableCounts(conn);
  setStatus('已连接', '');
}

function refreshConnSelect() {
  // 连接选择框和当前连接信息已移除，保留空函数兼容调用
}