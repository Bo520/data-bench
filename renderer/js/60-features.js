// ===== DataBench renderer: table ops & features =====
'use strict';
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