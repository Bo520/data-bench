// ===== DataBench renderer: database ops & table designer =====
'use strict';
function showDatabaseContextMenu(e, conn, t) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const dbAct = (fn) => {
    closeContextMenu();
    if (conn.database === t.name) fn();
    else useDatabase(conn.id, t.name).then(() => fn());
  };
  const open = el('div', 'ctx-item', t('menu.openDatabase'));
  open.addEventListener('click', () => { closeContextMenu(); useDatabase(conn.id, t.name); });
  const newTable = el('div', 'ctx-item', t('menu.newTable'));
  newTable.addEventListener('click', () => dbAct(() => openTableDesigner(conn)));
  const qb = el('div', 'ctx-item', t('menu.queryBuilder'));
  qb.addEventListener('click', () => dbAct(() => openQueryBuilder(conn)));
  const scheduler = el('div', 'ctx-item', t('menu.scheduler'));
  scheduler.addEventListener('click', () => dbAct(() => openSchedulerTab(conn.id)));
  const er = el('div', 'ctx-item', t('menu.erDiagram'));
  er.addEventListener('click', () => dbAct(() => openErTab(conn.id)));
  const edit = el('div', 'ctx-item', t('menu.editDatabase'));
  edit.addEventListener('click', () => { closeContextMenu(); openEditDatabase(conn, t.name); });
  const drop = el('div', 'ctx-item danger', t('menu.deleteDatabase'));
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