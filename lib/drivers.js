'use strict';

// 各数据库的元数据读取（表/库/表结构），只依赖传入的 conn 对象

const { quoteIdent } = require('./utils');

let mssql = null;
try { mssql = require('mssql'); } catch (e) { /* mssql 未安装时保持 null */ }

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

module.exports = {
  getMysqlDatabases,
  getMysqlTables,
  getSqliteTableInfo,
  getMysqlTableInfo,
  getPgDatabases,
  getPgTables,
  getPgTableInfo,
  getMssqlDatabases,
  getMssqlTables,
  getMssqlTableInfo,
};
