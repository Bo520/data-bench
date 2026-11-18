// ===== DataBench renderer: connection dialogs & menus =====
'use strict';
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
      c.database = resp.database;
      c.tables = resp.tables;
      if (resp.databases) c.databases = resp.databases;
    }
    refreshConnSelect();
    buildTree();
    setStatus(resp.name, '');
    openDatabaseTab(connId, database);
  } else {
    setStatus('错误：' + (resp && resp.error ? resp.error : '切换失败'), '');
  }
}

function openDatabaseTab(connId, dbName) {
  const existing = state.tabs.find((t) => t.type === 'dbtables' && t.connId === connId && t.dbName === dbName);
  if (existing) { activateTab(existing.id); if (existing.refreshData) existing.refreshData(); return existing; }

  const conn = connById(connId);
  const tab = makeTab('dbtables', '数据库 ' + dbName, connId, { dbName });

  const bar = el('div', 'editor-toolbar');
  const selInfo = el('span', 'hint', '');
  const refreshBtn = el('button', 'tb', '刷新');
  const dropBtn = el('button', 'tb', '删除选中表');
  bar.appendChild(selInfo);
  bar.appendChild(el('span', 'spacer'));
  bar.appendChild(refreshBtn);
  bar.appendChild(dropBtn);

  const meta = el('div', 'results-meta', '');
  const grid = el('div', 'results-grid');
  tab.el.appendChild(bar);
  tab.el.appendChild(meta);
  tab.el.appendChild(grid);

  let checks = [];

  function updateSel() {
    const n = checks.filter((c) => c.checked).length;
    selInfo.textContent = n ? '已选 ' + n + ' 项' : '';
  }

  function render() {
    const tables = (conn.tables || []).filter((t) => t.type !== 'database');
    meta.className = 'results-meta ok';
    meta.textContent = '共 ' + tables.length + ' 个对象（表/视图），双击打开';
    grid.innerHTML = '';
    const table = el('table', 'grid');
    const thead = el('thead');
    const hr = el('tr');
    const thCb = el('th', null, '');
    const allCb = el('input'); allCb.type = 'checkbox'; allCb.title = '全选/取消全选';
    thCb.appendChild(allCb);
    hr.appendChild(thCb);
    ['名称', '类型', '行数'].forEach((h) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    checks = [];
    tables.forEach((t) => {
      const tr = el('tr');
      const tdCb = el('td');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = t.name;
      cb.addEventListener('change', updateSel);
      checks.push(cb);
      tdCb.appendChild(cb);
      tr.appendChild(tdCb);
      tr.appendChild(el('td', null, t.name));
      tr.appendChild(el('td', null, t.type === 'view' ? '视图' : '表'));
      const count = (conn.tableCounts && conn.tableCounts[t.name] !== undefined) ? String(conn.tableCounts[t.name]) : '';
      tr.appendChild(el('td', null, count));
      tr.addEventListener('dblclick', () => openTableTab(connId, t.name));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    grid.appendChild(table);
    allCb.addEventListener('change', () => {
      checks.forEach((c) => { c.checked = allCb.checked; });
      updateSel();
    });
    updateSel();
  }

  async function refreshData() {
    conn.tables = await window.api.tables(conn.id);
    if (isRemote(conn)) conn.databases = await window.api.databases(conn.id);
    conn.tableCounts = await window.api.tableCounts(conn.id);
    buildTree();
    render();
  }

  refreshBtn.addEventListener('click', refreshData);

  dropBtn.addEventListener('click', async () => {
    const names = checks.filter((c) => c.checked).map((c) => c.value);
    if (!names.length) { setStatus('请先勾选要删除的表', ''); return; }
    if (!(await confirmModal('确定删除 ' + names.length + ' 张表？此操作不可恢复！'))) return;
    let done = 0, failed = 0;
    for (const name of names) {
      const item = (conn.tables || []).find((x) => x.name === name);
      const sql = (item && item.type === 'view' ? 'DROP VIEW ' : 'DROP TABLE ') + qIdent(conn, name);
      const r = await window.api.query(conn.id, sql);
      if (r && r.error) failed++; else done++;
    }
    setStatus('已删除 ' + done + ' 张表' + (failed ? '，失败 ' + failed + ' 张' : ''), '');
    await refreshData();
  });

  tab.refreshData = refreshData;
  activateTab(tab.id);
  refreshData();
  return tab;
}

function newConnection() {
  $('#conn-type-modal').classList.remove('hidden');
}

function showConnContextMenu(e, conn) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const newGroup = el('div', 'ctx-item', '新建分组');
  newGroup.addEventListener('click', () => { closeContextMenu(); createGroup(); });
  menu.appendChild(newGroup);
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
  if (groupOfKey(connServerKey(conn))) {
    const ungroup = el('div', 'ctx-item', '移出分组');
    ungroup.addEventListener('click', () => { closeContextMenu(); setGroupOfKey(connServerKey(conn), ''); buildTree(); });
    menu.appendChild(ungroup);
  }
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

function showGroupContextMenu(e, g) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const rename = el('div', 'ctx-item', '重命名分组');
  rename.addEventListener('click', async () => {
    closeContextMenu();
    const name = await promptModal('分组名称：', g.name);
    if (name && name.trim() && name.trim() !== g.name) {
      const list = loadGroups().map((x) => (x.id === g.id ? { id: x.id, name: name.trim() } : x));
      saveGroups(list);
      buildTree();
    }
  });
  const del = el('div', 'ctx-item danger', '删除分组');
  del.addEventListener('click', async () => {
    closeContextMenu();
    if (!(await confirmModal('删除分组「' + g.name + '」？（连接不会被删除，会移到未分组）'))) return;
    saveGroups(loadGroups().filter((x) => x.id !== g.id));
    const m = loadGroupMap();
    Object.keys(m).forEach((k) => { if (m[k] === g.id) delete m[k]; });
    saveGroupMap(m);
    buildTree();
  });
  menu.appendChild(rename);
  menu.appendChild(del);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

async function createGroup() {
  const name = await promptModal('分组名称：', '');
  if (name && name.trim()) {
    const list = loadGroups();
    list.push({ id: 'g' + Date.now(), name: name.trim() });
    saveGroups(list);
    buildTree();
  }
}

function showTreeContextMenu(e) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const newGroup = el('div', 'ctx-item', '新建分组');
  newGroup.addEventListener('click', () => { closeContextMenu(); createGroup(); });
  menu.appendChild(newGroup);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

function showClosedConnContextMenu(e, key) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  if (groupOfKey(key)) {
    const ungroup = el('div', 'ctx-item', '移出分组');
    ungroup.addEventListener('click', () => { closeContextMenu(); setGroupOfKey(key, ''); buildTree(); });
    menu.appendChild(ungroup);
  }
  if (!menu.children.length) return;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
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