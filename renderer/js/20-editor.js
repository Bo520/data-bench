// ===== DataBench renderer: SQL editor & autocomplete =====
'use strict';
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