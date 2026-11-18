'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const LOG_FILES = [
  path.join(os.homedir(), 'data-bench.log'),
];
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
  for (const f of LOG_FILES) {
    try { fs.appendFileSync(f, line); } catch (e) { /* ignore */ }
  }
}
log('[BOOT]', 'dir=', __dirname, 'execPath=', process.execPath, 'cwd=', process.cwd(), 'argv=', process.argv, 'type=', process.type, 'electron=', process.versions.electron);

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const initSqlJs = require('sql.js');
let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  log('mysql2 load failed:', e && e.message);
}
let pg = null;
try {
  pg = require('pg');
} catch (e) {
  log('pg load failed:', e && e.message);
}
let mssql = null;
try {
  mssql = require('mssql');
} catch (e) {
  log('mssql load failed:', e && e.message);
}
let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (e) {
  log('xlsx load failed:', e && e.message);
}
log('[REQUIRES OK]');

// 兼容性处理：禁用硬件加速、禁用渲染器沙箱（解决低完整性目录下渲染进程 exitCode 18 启动失败）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

let mainWindow = null;
let SQL = null;

// id -> { id, type:'sqlite', name, path, db }
//     -> { id, type:'mysql', name, host, port, user, password, database, pool }
const connections = new Map();
let nextConnId = 1;

const recentPath = () => path.join(app.getPath('userData'), 'recent.json');

async function ensureSqlJs() {
  if (!SQL) {
    const distDir = path.dirname(require.resolve('sql.js'));
    const wasmBinary = fs.readFileSync(path.join(distDir, 'sql-wasm.wasm'));
    SQL = await initSqlJs({ wasmBinary });
  }
  return SQL;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function loadRecent() {
  try {
    const data = fs.readFileSync(recentPath(), 'utf8');
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr.filter((p) => typeof p === 'string') : [];
  } catch (e) {
    return [];
  }
}

function saveRecent(list) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(recentPath(), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) { /* ignore persistence errors */ }
}

function pushRecent(filePath) {
  const list = loadRecent().filter((p) => p !== filePath);
  list.unshift(filePath);
  saveRecent(list.slice(0, 20));
}

function openDatabase(filePath) {
  return new SQL.Database(fs.readFileSync(filePath));
}

function createConnection(filePath) {
  const id = nextConnId++;
  const db = openDatabase(filePath);
  const conn = { id, name: path.basename(filePath), path: filePath, db };
  connections.set(id, conn);
  return conn;
}

function getTables(conn) {
  try {
    const r = conn.db.exec(
      "SELECT type, name, sql FROM sqlite_master " +
      "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' " +
      "ORDER BY (type='table') DESC, name COLLATE NOCASE"
    );
    return (r[0]?.values || []).map((v) => ({ type: v[0], name: v[1], sql: v[2] || '' }));
  } catch (e) {
    return [];
  }
}

function describeConnection(conn) {
  return { id: conn.id, name: conn.name, path: conn.path, tables: getTables(conn) };
}

function saveConnection(conn) {
  try {
    const bytes = conn.db.export();
    fs.writeFileSync(conn.path, Buffer.from(bytes));
    return true;
  } catch (e) {
    return false;
  }
}

function quoteMysqlIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function quoteMssqlIdent(name) {
  return '[' + String(name).replace(/\]/g, ']]') + ']';
}

function remoteDisplayName(cfg) {
  return (cfg.user || 'root') + '@' + (cfg.host || '127.0.0.1') + ':' + (cfg.port || '');
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (d ? d + ' 天 ' : '') + h + ' 时 ' + m + ' 分 ' + s + ' 秒';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function mysqlToResultSet(rows, fields) {
  const columns = (fields || []).map((f) => f.name);
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

function mysqlToResultSetFromRows(rows) {
  const columns = (rows && rows.length) ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

function mysqlDisplayName(cfg) {
  return (cfg.user || 'root') + '@' + (cfg.host || '127.0.0.1') + ':' + (cfg.port || 3306);
}

async function getMysqlDatabases(conn) {
  try {
    const [dbs] = await conn.pool.query('SHOW DATABASES');
    return dbs.map((r) => ({ type: 'database', name: Object.values(r)[0], sql: '' }));
  } catch (e) {
    return [];
  }
}

async function getMysqlTables(conn) {
  if (!conn.database) return [];
  try {
    const [rows] = await conn.pool.query(
      'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [conn.database]
    );
    return rows.map((r) => ({
      type: String(r.TABLE_TYPE).toLowerCase().includes('view') ? 'view' : 'table',
      name: r.TABLE_NAME,
      sql: '',
    }));
  } catch (e) {
    return [];
  }
}

function getSqliteTableInfo(conn, table) {
  const ident = quoteIdent(table);
  const colRes = conn.db.exec('PRAGMA table_info(' + ident + ')');
  const columns = (colRes[0]?.values || []).map((v) => ({
    name: v[1],
    type: v[2],
    notnull: !!v[3],
    dflt: v[4] === null ? '' : String(v[4]),
    pk: !!v[5],
  }));
  const idxRes = conn.db.exec('PRAGMA index_list(' + ident + ')');
  const indexes = (idxRes[0]?.values || []).map((v) => ({ name: v[1], unique: !!v[2], columns: '' }));
  for (const ix of indexes) {
    const icRes = conn.db.exec('PRAGMA index_info(' + quoteIdent(ix.name) + ')');
    ix.columns = (icRes[0]?.values || []).map((v) => v[2]).join(', ');
  }
  const primaryKey = columns.filter((c) => c.pk).map((c) => c.name);
  return { columns, indexes, primaryKey };
}

async function getMysqlTableInfo(conn, table) {
  const [cols] = await conn.pool.query(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [conn.database, table]
  );
  const columns = cols.map((c) => ({
    name: c.COLUMN_NAME,
    type: c.COLUMN_TYPE,
    notnull: c.IS_NULLABLE === 'NO',
    dflt: c.COLUMN_DEFAULT === null ? '' : String(c.COLUMN_DEFAULT),
    pk: c.COLUMN_KEY === 'PRI',
    extra: c.EXTRA,
  }));
  const [idxs] = await conn.pool.query(
    'SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? GROUP BY INDEX_NAME, NON_UNIQUE ORDER BY INDEX_NAME',
    [conn.database, table]
  );
  const indexes = idxs.map((i) => ({ name: i.INDEX_NAME, unique: !i.NON_UNIQUE, columns: i.cols }));
  const primaryKey = columns.filter((c) => c.pk).map((c) => c.name);
  return { columns, indexes, primaryKey };
}

async function getPgDatabases(conn) {
  try {
    const r = await conn.pool.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname');
    return r.rows.map((row) => ({ type: 'database', name: row.datname, sql: '' }));
  } catch (e) { return []; }
}

async function getPgTables(conn) {
  if (!conn.database) return [];
  try {
    const r = await conn.pool.query(
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name"
    );
    return r.rows.map((row) => ({
      type: String(row.table_type).toLowerCase().includes('view') ? 'view' : 'table',
      name: row.table_name,
      sql: '',
    }));
  } catch (e) { return []; }
}

async function getPgTableInfo(conn, table) {
  const colRes = await conn.pool.query(
    'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position',
    [table]
  );
  const columns = colRes.rows.map((c) => ({
    name: c.column_name,
    type: c.data_type,
    notnull: c.is_nullable === 'NO',
    dflt: c.column_default === null ? '' : String(c.column_default),
    pk: false,
  }));
  const pkRes = await conn.pool.query(
    "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() AND tc.table_name = $1",
    [table]
  );
  const pkNames = pkRes.rows.map((r) => r.column_name);
  columns.forEach((c) => { if (pkNames.includes(c.name)) c.pk = true; });
  return { columns, indexes: [], primaryKey: pkNames };
}

function pgToResultSet(result) {
  const columns = (result.fields || []).map((f) => f.name);
  return { columns, rows: result.rows.map((row) => columns.map((c) => row[c])) };
}

function mssqlToResultSet(recordset) {
  const rows = recordset || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((row) => columns.map((c) => row[c])) };
}

async function getMssqlDatabases(conn) {
  try {
    const r = await conn.pool.request().query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name');
    return (r.recordset || []).map((row) => ({ type: 'database', name: row.name, sql: '' }));
  } catch (e) { return []; }
}

async function getMssqlTables(conn) {
  if (!conn.database) return [];
  try {
    const r = await conn.pool.request().query("SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE','VIEW') ORDER BY TABLE_NAME");
    return (r.recordset || []).map((row) => ({
      type: String(row.TABLE_TYPE).toLowerCase().includes('view') ? 'view' : 'table',
      name: row.TABLE_NAME,
      sql: '',
    }));
  } catch (e) { return []; }
}

async function getMssqlTableInfo(conn, table) {
  const req1 = conn.pool.request();
  req1.input('t', mssql.NVarChar, table);
  const colRes = await req1.query('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION');
  const columns = (colRes.recordset || []).map((c) => ({
    name: c.COLUMN_NAME,
    type: c.DATA_TYPE,
    notnull: c.IS_NULLABLE === 'NO',
    dflt: c.COLUMN_DEFAULT === null || c.COLUMN_DEFAULT === undefined ? '' : String(c.COLUMN_DEFAULT),
    pk: false,
  }));
  const req2 = conn.pool.request();
  req2.input('t', mssql.NVarChar, table);
  const pkRes = await req2.query(
    "SELECT KCU.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU ON TC.CONSTRAINT_NAME = KCU.CONSTRAINT_NAME AND TC.TABLE_SCHEMA = KCU.TABLE_SCHEMA WHERE TC.CONSTRAINT_TYPE = 'PRIMARY KEY' AND KCU.TABLE_NAME = @t"
  );
  const pkNames = (pkRes.recordset || []).map((r) => r.COLUMN_NAME);
  columns.forEach((c) => { if (pkNames.includes(c.name)) c.pk = true; });
  return { columns, indexes: [], primaryKey: pkNames };
}

function createWindow() {
  log('createWindow start');
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    title: 'DataBench',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  log('BrowserWindow created');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => log('renderer did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => log('did-fail-load', code, desc));
  mainWindow.webContents.on('console-message', (...args) => {
    const msg = args[2] ?? (args[0] && args[0].message) ?? '';
    log('[renderer]', msg);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => log('render-process-gone', details));
  mainWindow.on('closed', () => {
    log('window closed');
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('db:openFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '打开数据库',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    try {
      await ensureSqlJs();
      const conn = createConnection(res.filePaths[0]);
      pushRecent(conn.path);
      return describeConnection(conn);
    } catch (e) {
      return { error: '无法打开数据库：' + (e.message || e) };
    }
  });

  ipcMain.handle('db:createFile', async () => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '新建数据库',
      defaultPath: path.join(app.getPath('documents'), 'new.db'),
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (res.canceled || !res.filePath) return null;
    try {
      await ensureSqlJs();
      const empty = new SQL.Database();
      fs.writeFileSync(res.filePath, Buffer.from(empty.export()));
      empty.close();
      const conn = createConnection(res.filePath);
      pushRecent(conn.path);
      return describeConnection(conn);
    } catch (e) {
      return { error: '创建失败：' + (e.message || e) };
    }
  });

  ipcMain.handle('db:openPath', async (e, filePath) => {
    try {
      await ensureSqlJs();
      if (!fs.existsSync(filePath)) return { error: '文件不存在：' + filePath };
      const conn = createConnection(filePath);
      pushRecent(conn.path);
      return describeConnection(conn);
    } catch (err) {
      return { error: '无法打开数据库：' + (err.message || err) };
    }
  });

  ipcMain.handle('db:close', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return false;
    if (conn.type === 'mysql' || conn.type === 'postgres') {
      try { await conn.pool.end(); } catch (err) { log('pool end err', err && err.message); }
      connections.delete(id);
      return true;
    }
    if (conn.type === 'mssql') {
      try { await conn.pool.close(); } catch (err) { log('pool close err', err && err.message); }
      connections.delete(id);
      return true;
    }
    conn.db.close();
    connections.delete(id);
    return true;
  });

  ipcMain.handle('db:tables', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return [];
    if (conn.type === 'mysql') return getMysqlTables(conn);
    if (conn.type === 'postgres') return getPgTables(conn);
    if (conn.type === 'mssql') return getMssqlTables(conn);
    return getTables(conn);
  });

  ipcMain.handle('db:databases', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return [];
    if (conn.type === 'mysql') return getMysqlDatabases(conn);
    if (conn.type === 'postgres') return getPgDatabases(conn);
    if (conn.type === 'mssql') return getMssqlDatabases(conn);
    return [];
  });

  ipcMain.handle('db:tableData', async (e, { id, table, limit, offset, where }) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    const l = Math.max(1, Math.min(Number(limit) || 500, 5000));
    const o = Math.max(0, Number(offset) || 0);
    const w = (typeof where === 'string' && where.trim()) ? ' WHERE ' + where.trim() : '';
    try {
      if (conn.type === 'mysql') {
        const t = quoteMysqlIdent(table);
        const q = (conn.database ? quoteMysqlIdent(conn.database) + '.' : '') + t;
        const [rows, fields] = await conn.pool.query('SELECT * FROM ' + q + w + ' LIMIT ' + l + ' OFFSET ' + o);
        const [cr] = await conn.pool.query('SELECT COUNT(*) AS c FROM ' + q + w);
        const total = Number(cr[0]?.c ?? 0);
        const rs = mysqlToResultSet(rows, fields);
        return { ok: true, columns: rs.columns, rows: rs.rows, total };
      }
      if (conn.type === 'postgres') {
        const q = quoteIdent(table);
        const r = await conn.pool.query('SELECT * FROM ' + q + w + ' LIMIT ' + l + ' OFFSET ' + o);
        const cr = await conn.pool.query('SELECT COUNT(*) AS c FROM ' + q + w);
        const total = Number(cr.rows[0]?.c ?? 0);
        const rs = pgToResultSet(r);
        return { ok: true, columns: rs.columns, rows: rs.rows, total };
      }
      if (conn.type === 'mssql') {
        const q = quoteMssqlIdent(table);
        const cr = await conn.pool.request().query('SELECT COUNT(*) AS c FROM ' + q + w);
        const total = Number((cr.recordset[0] || {}).c ?? 0);
        const r = await conn.pool.request().query('SELECT * FROM ' + q + w + ' ORDER BY (SELECT NULL) OFFSET ' + o + ' ROWS FETCH NEXT ' + l + ' ROWS ONLY');
        const rs = mssqlToResultSet(r.recordset);
        return { ok: true, columns: rs.columns, rows: rs.rows, total };
      }
      const ident = quoteIdent(table);
      const r = conn.db.exec('SELECT * FROM ' + ident + w + ' LIMIT ' + l + ' OFFSET ' + o);
      const cr = conn.db.exec('SELECT COUNT(*) AS c FROM ' + ident + w);
      const total = Number((cr[0]?.values?.[0]?.[0]) ?? 0);
      return { ok: true, columns: r[0]?.columns || [], rows: r[0]?.values || [], total };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:query', async (e, { id, sql }) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    if (typeof sql !== 'string' || !sql.trim()) {
      return { ok: true, results: [], changes: 0, saved: false };
    }
    try {
      if (conn.type === 'mysql') {
        const raw = await conn.pool.query(sql);
        const first = raw && raw[0];
        if (Array.isArray(first) && first.length > 0 && Array.isArray(first[0])) {
          const results = first.map((rows) => mysqlToResultSetFromRows(rows));
          return { ok: true, results, changes: 0, saved: false };
        }
        if (Array.isArray(first)) {
          const rs = mysqlToResultSet(first, raw[1]);
          return { ok: true, results: [rs], changes: 0, saved: false };
        }
        return { ok: true, results: [], changes: (first && first.affectedRows) || 0, saved: false };
      }
      if (conn.type === 'postgres') {
        const r = await conn.pool.query(sql);
        if (r.fields && r.fields.length) {
          const rs = pgToResultSet(r);
          return { ok: true, results: [rs], changes: 0, saved: false };
        }
        return { ok: true, results: [], changes: r.rowCount || 0, saved: false };
      }
      if (conn.type === 'mssql') {
        const r = await conn.pool.request().query(sql);
        const rows = r.recordset || [];
        const columns = rows.length ? Object.keys(rows[0]) : [];
        const changes = (r.rowsAffected && r.rowsAffected[0]) || 0;
        if (columns.length) {
          return { ok: true, results: [{ columns, rows: rows.map((row) => columns.map((c) => row[c])) }], changes: 0, saved: false };
        }
        return { ok: true, results: [], changes, saved: false };
      }
      const results = conn.db.exec(sql);
      const changes = conn.db.getRowsModified();
      const wrote = /^\s*(insert|update|delete|replace|create|drop|alter|vacuum|attach|detach|pragma)\b/i.test(sql);
      const saved = wrote ? saveConnection(conn) : false;
      return {
        ok: true,
        results: (results || []).map((r) => ({ columns: r.columns, rows: r.values })),
        changes,
        saved,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:save', (e, id) => {
    const conn = connections.get(id);
    if (!conn) return false;
    return saveConnection(conn);
  });

  ipcMain.handle('db:recent', () => loadRecent());

  ipcMain.handle('mysql:connect', async (e, cfg) => {
    if (!mysql) return { error: 'MySQL 组件未安装' };
    if (!cfg || !cfg.host) return { error: '请填写主机地址' };
    const host = String(cfg.host || '127.0.0.1').trim();
    const port = Number(cfg.port) || 3306;
    const user = String(cfg.user || 'root').trim();
    const password = String(cfg.password || '');
    const database = String(cfg.database || '').trim();
    let pool = null;
    try {
      pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 5, charset: 'utf8mb4', multipleStatements: true });
      await pool.query('SELECT 1');
    } catch (err) {
      if (pool) { try { await pool.end(); } catch (e) {} }
      return { error: 'MySQL 连接失败：' + (err.message || err) };
    }
    const id = nextConnId++;
    const flavor = String(cfg.flavor || 'mysql');
    const conn = { id, type: 'mysql', flavor, name: String(cfg.name || '').trim() || mysqlDisplayName({ host, port, user, database }), host, port, user, password, database, pool };
    connections.set(id, conn);
    const tables = await getMysqlTables(conn);
    const databases = await getMysqlDatabases(conn);
    return { id, type: 'mysql', flavor, name: conn.name, host, port, user, database, tables, databases };
  });

  ipcMain.handle('mysql:useDatabase', async (e, { id, database }) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'mysql') return { error: '连接不存在' };
    const db = String(database || '');
    let newPool = null;
    try {
      newPool = mysql.createPool({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: db, connectionLimit: 5, charset: 'utf8mb4', multipleStatements: true });
      await newPool.query('SELECT 1');
    } catch (err) {
      if (newPool) { try { await newPool.end(); } catch (e) {} }
      return { ok: false, error: '切换数据库失败：' + (err.message || err) };
    }
    const oldPool = conn.pool;
    conn.pool = newPool;
    conn.database = db;
    try { await oldPool.end(); } catch (e) {}
    const tables = await getMysqlTables(conn);
    const databases = await getMysqlDatabases(conn);
    return { ok: true, name: conn.name, database: db, tables, databases };
  });

  ipcMain.handle('pg:connect', async (e, cfg) => {
    if (!pg) return { error: 'PostgreSQL 组件未安装' };
    if (!cfg || !cfg.host) return { error: '请填写主机地址' };
    const host = String(cfg.host || '127.0.0.1').trim();
    const port = Number(cfg.port) || 5432;
    const user = String(cfg.user || 'postgres').trim();
    const password = String(cfg.password || '');
    const database = String(cfg.database || '').trim();
    let pool = null;
    try {
      pool = new pg.Pool({ host, port, user, password, database, max: 5 });
      await pool.query('SELECT 1');
    } catch (err) {
      if (pool) { try { await pool.end(); } catch (e) {} }
      return { error: 'PostgreSQL 连接失败：' + (err.message || err) };
    }
    const id = nextConnId++;
    const conn = { id, type: 'postgres', name: String(cfg.name || '').trim() || remoteDisplayName({ host, port, user, database }), host, port, user, password, database, pool };
    connections.set(id, conn);
    const tables = await getPgTables(conn);
    const databases = await getPgDatabases(conn);
    return { id, type: 'postgres', name: conn.name, host, port, user, database, tables, databases };
  });

  ipcMain.handle('pg:useDatabase', async (e, { id, database }) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'postgres') return { error: '连接不存在' };
    const db = String(database || '');
    let newPool = null;
    try {
      newPool = new pg.Pool({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: db, max: 5 });
      await newPool.query('SELECT 1');
    } catch (err) {
      if (newPool) { try { await newPool.end(); } catch (e) {} }
      return { ok: false, error: '切换数据库失败：' + (err.message || err) };
    }
    const oldPool = conn.pool;
    conn.pool = newPool;
    conn.database = db;
    try { await oldPool.end(); } catch (e) {}
    const tables = await getPgTables(conn);
    const databases = await getPgDatabases(conn);
    return { ok: true, name: conn.name, database: db, tables, databases };
  });

  ipcMain.handle('mssql:connect', async (e, cfg) => {
    if (!mssql) return { error: 'SQL Server 组件未安装' };
    if (!cfg || !cfg.host) return { error: '请填写主机地址' };
    const host = String(cfg.host || '127.0.0.1').trim();
    const port = Number(cfg.port) || 1433;
    const user = String(cfg.user || 'sa').trim();
    const password = String(cfg.password || '');
    const database = String(cfg.database || '').trim();
    let pool = null;
    try {
      const mscfg = {
        server: host,
        port,
        user,
        password,
        database: database || undefined,
        options: { encrypt: false, enableArithAbort: true },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      };
      pool = await new mssql.ConnectionPool(mscfg).connect();
      await pool.request().query('SELECT 1');
    } catch (err) {
      if (pool) { try { await pool.close(); } catch (e) {} }
      return { error: 'SQL Server 连接失败：' + (err.message || err) };
    }
    const id = nextConnId++;
    const conn = { id, type: 'mssql', name: String(cfg.name || '').trim() || remoteDisplayName({ host, port, user, database }), host, port, user, password, database, pool };
    connections.set(id, conn);
    const tables = await getMssqlTables(conn);
    const databases = await getMssqlDatabases(conn);
    return { id, type: 'mssql', name: conn.name, host, port, user, database, tables, databases };
  });

  ipcMain.handle('mssql:useDatabase', async (e, { id, database }) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'mssql') return { error: '连接不存在' };
    const db = String(database || '');
    let newPool = null;
    try {
      const mscfg = {
        server: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: db || undefined,
        options: { encrypt: false, enableArithAbort: true },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      };
      newPool = await new mssql.ConnectionPool(mscfg).connect();
      await newPool.request().query('SELECT 1');
    } catch (err) {
      if (newPool) { try { await newPool.close(); } catch (e) {} }
      return { ok: false, error: '切换数据库失败：' + (err.message || err) };
    }
    const oldPool = conn.pool;
    conn.pool = newPool;
    conn.database = db;
    try { await oldPool.close(); } catch (e) {}
    const tables = await getMssqlTables(conn);
    const databases = await getMssqlDatabases(conn);
    return { ok: true, name: conn.name, database: db, tables, databases };
  });

  ipcMain.handle('db:tableInfo', async (e, { id, table }) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    try {
      if (conn.type === 'mysql') return { ok: true, ...(await getMysqlTableInfo(conn, table)) };
      if (conn.type === 'postgres') return { ok: true, ...(await getPgTableInfo(conn, table)) };
      if (conn.type === 'mssql') return { ok: true, ...(await getMssqlTableInfo(conn, table)) };
      return { ok: true, ...getSqliteTableInfo(conn, table) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:execute', async (e, { id, sql, params }) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    try {
      if (conn.type === 'mysql') {
        const [result] = await conn.pool.execute(sql, params || []);
        return { ok: true, affectedRows: result.affectedRows || 0 };
      }
      if (conn.type === 'postgres') {
        let i = 0;
        const converted = sql.replace(/\?/g, () => '$' + (++i));
        const result = await conn.pool.query(converted, params || []);
        return { ok: true, affectedRows: result.rowCount || 0 };
      }
      if (conn.type === 'mssql') {
        const request = conn.pool.request();
        let i = 0;
        const converted = sql.replace(/\?/g, () => {
          const v = (params || [])[i];
          i++;
          const name = 'p' + i;
          if (v === null || v === undefined) request.input(name, mssql.NVarChar, null);
          else request.input(name, v);
          return '@' + name;
        });
        const result = await request.query(converted);
        return { ok: true, affectedRows: (result.rowsAffected && result.rowsAffected[0]) || 0 };
      }
      conn.db.run(sql, params || []);
      saveConnection(conn);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:ddl', async (e, { id, table }) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    try {
      if (conn.type === 'sqlite') {
        const r = conn.db.exec('SELECT sql FROM sqlite_master WHERE name = ' + quoteIdent(table));
        return { ok: true, ddl: (r[0]?.values?.[0]?.[0]) || '' };
      }
      if (conn.type === 'mysql') {
        const [rows] = await conn.pool.query('SHOW CREATE TABLE ' + quoteMysqlIdent(table));
        return { ok: true, ddl: (rows[0] && (rows[0]['Create Table'] || rows[0]['Create View'])) || '' };
      }
      if (conn.type === 'postgres') {
        const info = await getPgTableInfo(conn, table);
        const defs = info.columns.map((c) => quoteIdent(c.name) + ' ' + c.type + (c.notnull ? ' NOT NULL' : '') + (c.dflt ? ' DEFAULT ' + c.dflt : '') + (c.pk && info.primaryKey.length === 1 ? ' PRIMARY KEY' : ''));
        return { ok: true, ddl: 'CREATE TABLE ' + quoteIdent(table) + ' (\n  ' + defs.join(',\n  ') + '\n);' };
      }
      if (conn.type === 'mssql') {
        const info = await getMssqlTableInfo(conn, table);
        const defs = info.columns.map((c) => quoteMssqlIdent(c.name) + ' ' + c.type + (c.notnull ? ' NOT NULL' : '') + (c.dflt ? ' DEFAULT ' + c.dflt : '') + (c.pk && info.primaryKey.length === 1 ? ' PRIMARY KEY' : ''));
        return { ok: true, ddl: 'CREATE TABLE ' + quoteMssqlIdent(table) + ' (\n  ' + defs.join(',\n  ') + '\n);' };
      }
      return { ok: true, ddl: '' };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:testConnection', async (e, cfg) => {
    const type = String((cfg && cfg.type) || '');
    const host = String((cfg && cfg.host) || '127.0.0.1').trim();
    const user = String((cfg && cfg.user) || '').trim();
    const password = String((cfg && cfg.password) || '');
    const database = String((cfg && cfg.database) || '').trim();
    try {
      if (type === 'mysql' || type === 'mariadb') {
        if (!mysql) return { error: 'MySQL 组件未安装' };
        const pool = mysql.createPool({ host, port: Number(cfg.port) || 3306, user, password, database, connectionLimit: 2 });
        try { await pool.query('SELECT 1'); } finally { await pool.end(); }
        return { ok: true };
      }
      if (type === 'postgres') {
        if (!pg) return { error: 'PostgreSQL 组件未安装' };
        const client = new pg.Client({ host, port: Number(cfg.port) || 5432, user, password, database });
        try { await client.connect(); await client.query('SELECT 1'); } finally { await client.end().catch(() => {}); }
        return { ok: true };
      }
      if (type === 'mssql') {
        if (!mssql) return { error: 'SQL Server 组件未安装' };
        const pool = await new mssql.ConnectionPool({ server: host, port: Number(cfg.port) || 1433, user, password, database: database || undefined, options: { encrypt: false, enableArithAbort: true } }).connect();
        try { await pool.request().query('SELECT 1'); } finally { await pool.close(); }
        return { ok: true };
      }
      return { error: '未知数据库类型' };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:importCsv', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '导入 CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const content = fs.readFileSync(res.filePaths[0], 'utf8');
      const rows = parseCsv(content);
      if (rows.length < 1) return { error: 'CSV 为空' };
      const header = rows[0].map((h) => h.trim()).filter((h) => h !== '');
      return { header, data: rows.slice(1) };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:saveText', async (e, { content, defaultName, filters }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出',
      defaultPath: defaultName || 'export.txt',
      filters: filters || [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      fs.writeFileSync(res.filePath, content, 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:tableCounts', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return {};
    const counts = {};
    try {
      if (conn.type === 'sqlite') {
        for (const t of getTables(conn).filter((x) => x.type === 'table')) {
          const r = conn.db.exec('SELECT COUNT(*) AS c FROM ' + quoteIdent(t.name));
          counts[t.name] = Number(r[0]?.values?.[0]?.[0] ?? 0);
        }
      } else if (conn.type === 'mysql') {
        for (const t of await getMysqlTables(conn)) {
          if (t.type !== 'table') continue;
          const q = (conn.database ? quoteMysqlIdent(conn.database) + '.' : '') + quoteMysqlIdent(t.name);
          const [r] = await conn.pool.query('SELECT COUNT(*) AS c FROM ' + q);
          counts[t.name] = Number(r[0]?.c ?? 0);
        }
      } else if (conn.type === 'postgres') {
        for (const t of await getPgTables(conn)) {
          if (t.type !== 'table') continue;
          const r = await conn.pool.query('SELECT COUNT(*) AS c FROM ' + quoteIdent(t.name));
          counts[t.name] = Number(r.rows[0]?.c ?? 0);
        }
      } else if (conn.type === 'mssql') {
        for (const t of await getMssqlTables(conn)) {
          if (t.type !== 'table') continue;
          const r = await conn.pool.request().query('SELECT COUNT(*) AS c FROM ' + quoteMssqlIdent(t.name));
          counts[t.name] = Number((r.recordset[0] || {}).c ?? 0);
        }
      }
    } catch (err) { /* ignore */ }
    return counts;
  });

  ipcMain.handle('db:dumpSql', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    if (conn.type !== 'sqlite') return { error: '当前版本仅支持 SQLite 备份为 SQL' };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '备份为 SQL',
      defaultPath: (conn.name || 'db') + '.sql',
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      let out = '';
      const tables = getTables(conn).filter((t) => t.type === 'table');
      for (const t of tables) {
        if (t.sql && t.sql.trim()) out += t.sql.trim() + ';\n';
        const r = conn.db.exec('SELECT * FROM ' + quoteIdent(t.name));
        const cols = r[0]?.columns || [];
        const rows = r[0]?.values || [];
        if (cols.length && rows.length) {
          const colList = cols.map(quoteIdent).join(', ');
          for (const row of rows) {
            const vals = row.map((v) => (v === null || v === undefined ? 'NULL' : (typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"))).join(', ');
            out += 'INSERT INTO ' + quoteIdent(t.name) + ' (' + colList + ') VALUES (' + vals + ');\n';
          }
        }
      }
      fs.writeFileSync(res.filePath, out, 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:runSqlFile', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '恢复 SQL 文件',
      properties: ['openFile'],
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const sql = fs.readFileSync(res.filePaths[0], 'utf8');
      if (conn.type === 'sqlite') { conn.db.exec(sql); saveConnection(conn); return { ok: true }; }
      if (conn.type === 'mysql') { await conn.pool.query(sql); return { ok: true }; }
      if (conn.type === 'postgres') { await conn.pool.query(sql); return { ok: true }; }
      if (conn.type === 'mssql') { await conn.pool.request().batch(sql); return { ok: true }; }
      return { error: '未知连接类型' };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:serverInfo', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return { error: '连接不存在' };
    try {
      if (conn.type === 'mysql') {
        const [ver] = await conn.pool.query('SELECT VERSION() AS v');
        const [status] = await conn.pool.query('SHOW STATUS');
        const [vars] = await conn.pool.query('SHOW VARIABLES');
        const s = {}; status.forEach((r) => { s[r.Variable_name] = r.Value; });
        const v = {}; vars.forEach((r) => { v[r.Variable_name] = r.Value; });
        const uptime = Number(s.Uptime) || 1;
        const qps = (Number(s.Questions) || 0) / uptime;
        return { ok: true, rows: [
          ['服务器版本', ver[0].v],
          ['运行时间', fmtUptime(uptime)],
          ['当前连接数', s.Threads_connected || '0'],
          ['运行中线程', s.Threads_running || '0'],
          ['历史最大连接数', s.Max_used_connections || '0'],
          ['连接数上限', v.max_connections || ''],
          ['累计查询数', s.Questions || '0'],
          ['慢查询数', s.Slow_queries || '0'],
          ['平均 QPS', qps.toFixed(2)],
          ['发送字节', s.Bytes_sent || '0'],
          ['接收字节', s.Bytes_received || '0'],
          ['字符集', v.character_set_server || ''],
        ] };
      }
      if (conn.type === 'postgres') {
        const [ver] = await conn.pool.query('SELECT version() AS v');
        const r = await conn.pool.query("SELECT numbackends, xact_commit, xact_rollback, tup_inserted, tup_updated, tup_deleted FROM pg_stat_database WHERE datname = current_database()");
        const s = r.rows[0] || {};
        return { ok: true, rows: [
          ['服务器版本', ver.rows[0].v],
          ['当前连接数', String(s.numbackends ?? '')],
          ['已提交事务', String(s.xact_commit ?? '')],
          ['回滚事务', String(s.xact_rollback ?? '')],
          ['插入行数', String(s.tup_inserted ?? '')],
          ['更新行数', String(s.tup_updated ?? '')],
          ['删除行数', String(s.tup_deleted ?? '')],
        ] };
      }
      if (conn.type === 'mssql') {
        const r = await conn.pool.request().query('SELECT @@VERSION AS v');
        return { ok: true, rows: [['服务器版本', (r.recordset[0] || {}).v || '']] };
      }
      return { error: 'SQLite 无服务器监控' };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('db:listUsers', async (e, id) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'mysql') return { error: '仅支持 MySQL/MariaDB 用户管理' };
    try {
      const [rows] = await conn.pool.query('SELECT User, Host FROM mysql.user ORDER BY User, Host');
      return { ok: true, users: rows };
    } catch (err) { return { error: err.message || String(err) }; }
  });

  ipcMain.handle('db:createUser', async (e, { id, user, host, password }) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'mysql') return { error: '仅支持 MySQL/MariaDB' };
    try {
      const u = "'" + String(user).replace(/'/g, "''") + "'";
      const h = "'" + String(host).replace(/'/g, "''") + "'";
      await conn.pool.query('CREATE USER ' + u + '@' + h + ' IDENTIFIED BY ?', [String(password || '')]);
      return { ok: true };
    } catch (err) { return { error: err.message || String(err) }; }
  });

  ipcMain.handle('db:dropUser', async (e, { id, user, host }) => {
    const conn = connections.get(id);
    if (!conn || conn.type !== 'mysql') return { error: '仅支持 MySQL/MariaDB' };
    try {
      const u = "'" + String(user).replace(/'/g, "''") + "'";
      const h = "'" + String(host).replace(/'/g, "''") + "'";
      await conn.pool.query('DROP USER ' + u + '@' + h);
      return { ok: true };
    } catch (err) { return { error: err.message || String(err) }; }
  });

  ipcMain.handle('db:foreignKeys', async (e, id) => {
    const conn = connections.get(id);
    if (!conn) return [];
    try {
      if (conn.type === 'mysql') {
        const [rows] = await conn.pool.query(
          'SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
          [conn.database]
        );
        return rows.map((r) => ({ table: r.TABLE_NAME, column: r.COLUMN_NAME, refTable: r.REFERENCED_TABLE_NAME, refColumn: r.REFERENCED_COLUMN_NAME }));
      }
      if (conn.type === 'sqlite') {
        const fks = [];
        for (const t of getTables(conn).filter((x) => x.type === 'table')) {
          const r = conn.db.exec('PRAGMA foreign_key_list(' + quoteIdent(t.name) + ')');
          const rows = r[0]?.values || [];
          rows.forEach((v) => { fks.push({ table: t.name, column: v[3], refTable: v[2], refColumn: v[4] }); });
        }
        return fks;
      }
      if (conn.type === 'postgres') {
        const r = await conn.pool.query(
          "SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()"
        );
        return r.rows.map((x) => ({ table: x.table_name, column: x.column_name, refTable: x.ref_table, refColumn: x.ref_column }));
      }
      return [];
    } catch (err) { return []; }
  });

  ipcMain.handle('db:exportExcel', async (e, { columns, rows, defaultName }) => {
    if (!XLSX) return { error: 'Excel 组件未安装' };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Excel',
      defaultPath: defaultName || 'export.xlsx',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      const ws = XLSX.utils.aoa_to_sheet([columns || [], ...(rows || [])]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, res.filePath);
      return { ok: true, path: res.filePath };
    } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });

  ipcMain.handle('db:exportCsv', async (e, { csv, defaultName }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出 CSV',
      defaultPath: defaultName || 'export.csv',
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      fs.writeFileSync(res.filePath, csv, 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

process.on('uncaughtException', (err) => log('UNCAUGHT', err && (err.stack || err.message || err)));
process.on('unhandledRejection', (r) => log('UNHANDLED_REJECTION', r && (r.stack || r.message || r)));

app.whenReady().then(() => {
  log('app ready');
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => log('whenReady error', err && (err.stack || err.message || err)));

app.on('window-all-closed', () => {
  log('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
