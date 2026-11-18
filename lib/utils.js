'use strict';

// 纯工具函数：标识符引用、显示名、CSV 解析、结果集转换（无共享状态）

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
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

function pgToResultSet(result) {
  const columns = (result.fields || []).map((f) => f.name);
  return { columns, rows: result.rows.map((row) => columns.map((c) => row[c])) };
}

function mssqlToResultSet(recordset) {
  const rows = recordset || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((row) => columns.map((c) => row[c])) };
}

module.exports = {
  quoteIdent,
  quoteMysqlIdent,
  quoteMssqlIdent,
  remoteDisplayName,
  fmtUptime,
  parseCsv,
  mysqlToResultSet,
  mysqlToResultSetFromRows,
  mysqlDisplayName,
  pgToResultSet,
  mssqlToResultSet,
};
