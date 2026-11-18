// ===== DataBench renderer: core state & utils =====
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
  // 底部状态栏已移除，保留空函数兼容调用
}
function connSubtitle(conn) {
  if (!conn) return '';
  if (conn.type === 'mysql' || conn.type === 'postgres' || conn.type === 'mssql') return conn.host + ':' + conn.port;
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
function connServerKey(conn) {
  if (!conn) return '';
  if (conn.type === 'sqlite') return 'sqlite:' + (conn.path || '');
  return conn.type + '|' + (conn.host || '') + '|' + String(conn.port || '') + '|' + (conn.user || '');
}
function remoteCfgKey(cfg) {
  const type = (cfg.type === 'mariadb' || cfg.type === 'mysql') ? 'mysql' : (cfg.type || '');
  return type + '|' + (cfg.host || '') + '|' + String(cfg.port || '') + '|' + (cfg.user || '');
}
function cleanSavedName(cfg) {
  let n = (cfg.name || '').trim();
  const at = n.indexOf('@');
  if (at >= 0) {
    const slash = n.indexOf('/', at);
    if (slash > at) n = n.slice(0, slash);
  }
  return n || (cfg.user || 'root') + '@' + (cfg.host || '') + ':' + (cfg.port || '');
}

const GROUPS_KEY = 'connectionGroups';
const GROUP_MAP_KEY = 'connectionGroupMap';
function loadGroups() { try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch (e) { return []; } }
function saveGroups(list) { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(list)); } catch (e) {} }
function loadGroupMap() { try { return JSON.parse(localStorage.getItem(GROUP_MAP_KEY) || '{}'); } catch (e) { return {}; } }
function saveGroupMap(map) { try { localStorage.setItem(GROUP_MAP_KEY, JSON.stringify(map)); } catch (e) {} }
function groupOfKey(key) { return loadGroupMap()[key] || ''; }
function setGroupOfKey(key, gid) { const m = loadGroupMap(); if (gid) m[key] = gid; else delete m[key]; saveGroupMap(m); }
function makeDraggable(el, key) {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
  });
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
