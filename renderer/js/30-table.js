// ===== DataBench renderer: query/table tabs & data editing =====
'use strict';
function openQueryTab(connId) {
  const conn = connById(connId);
  const tab = makeTab('query', '查询 ' + (state.tabSeq + 1), connId, { sql: '' });

  const bar = el('div', 'editor-toolbar');
  const runBtn = el('button', 'run', '▶ 运行');
  const fmtBtn = el('button', 'tb', '格式化');
  const histBtn = el('button', 'tb', '历史');
  const snipBtn = el('button', 'tb', '片段');
  const chartBtn = el('button', 'tb', '图表');
  const hint = el('span', 'hint', 'Ctrl+Enter 运行 · 选中后只运行选中部分');
  bar.appendChild(runBtn);
  bar.appendChild(fmtBtn);
  bar.appendChild(histBtn);
  bar.appendChild(snipBtn);
  bar.appendChild(chartBtn);
  bar.appendChild(hint);

  const editorWrap = el('div', 'sql-editor-wrap');
  const highlighter = el('pre', 'sql-highlight');
  highlighter.setAttribute('aria-hidden', 'true');
  const editor = el('textarea', 'sql-editor');
  editor.placeholder = '在此输入 SQL 语句，例如：SELECT * FROM 表名;';
  editor.spellcheck = false;
  editor.autocorrect = 'off';
  editor.autocapitalize = 'off';
  editorWrap.appendChild(highlighter);
  editorWrap.appendChild(editor);

  const results = el('div', 'results');
  const meta = el('div', 'results-meta', '尚未执行');
  const grid = el('div', 'results-grid');
  const chartWrap = el('div', 'chart-wrap hidden');
  results.appendChild(meta);
  results.appendChild(grid);
  results.appendChild(chartWrap);

  tab.editor = editor;
  tab.meta = meta;
  tab.grid = grid;
  tab.chartWrap = chartWrap;
  tab.lastResult = null;

  tab.el.appendChild(bar);
  tab.el.appendChild(editorWrap);
  tab.el.appendChild(results);

  const run = async () => {
    const connNow = connById(state.activeId);
    if (!connNow) { meta.className = 'results-meta err'; meta.textContent = '请先打开或选择一个数据库连接'; return; }
    meta.className = 'results-meta';
    meta.textContent = '执行中…';
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    const sqlToRun = sel || editor.value;
    const resp = await window.api.query(state.activeId, sqlToRun);
    saveQueryHistory(sqlToRun);
    showQueryResults(tab, resp);
  };

  runBtn.addEventListener('click', run);
  histBtn.addEventListener('click', () => showQueryHistory(editor, histBtn));
  snipBtn.addEventListener('click', () => showSnippets(editor, snipBtn));
  chartBtn.addEventListener('click', () => {
    if (!tab.lastResult || !tab.lastResult.rows.length) { setStatus('请先运行一个返回结果的查询', ''); return; }
    const wasHidden = tab.chartWrap.classList.contains('hidden');
    if (wasHidden) {
      renderBarChart(tab.chartWrap, tab.lastResult.columns, tab.lastResult.rows);
      tab.chartWrap.classList.remove('hidden');
      grid.classList.add('hidden');
    } else {
      tab.chartWrap.classList.add('hidden');
      grid.classList.remove('hidden');
    }
  });
  fmtBtn.addEventListener('click', () => {
    editor.value = formatSql(editor.value);
    editor.dispatchEvent(new Event('input'));
    editor.focus();
  });
  editor.addEventListener('keydown', (e) => {
    if (acHandleKey(editor, e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
  });

  const syncHighlight = () => {
    highlighter.innerHTML = highlightSql(editor.value) + '\n';
    highlighter.scrollTop = editor.scrollTop;
    highlighter.scrollLeft = editor.scrollLeft;
  };
  editor.addEventListener('input', () => { syncHighlight(); acOpen(editor); });
  editor.addEventListener('scroll', syncHighlight);
  syncHighlight();

  activateTab(tab.id);
  editor.focus();
  return tab;
}

function qIdent(conn, name) {
  if (conn && conn.type === 'mysql') return '`' + String(name).replace(/`/g, '``') + '`';
  if (conn && conn.type === 'mssql') return '[' + String(name).replace(/\]/g, ']]') + ']';
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function qualifiedTable(conn, db, table) {
  if (db) return qIdent(conn, db) + '.' + qIdent(conn, table);
  return qIdent(conn, table);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function openTableTab(connId, table) {
  const existing = state.tabs.find((t) => t.type === 'table' && t.connId === connId && t.table === table);
  if (existing) { activateTab(existing.id); return existing; }

  const tab = makeTab('table', table, connId, { table });

  const subbar = el('div', 'subtabbar');
  const btnData = el('button', 'subtab active', '数据');
  const btnStruct = el('button', 'subtab', '结构');
  const btnDdl = el('button', 'subtab', 'DDL');
  btnData.addEventListener('click', () => switchSubTab(tab, 'data'));
  btnStruct.addEventListener('click', () => switchSubTab(tab, 'structure'));
  btnDdl.addEventListener('click', () => switchSubTab(tab, 'ddl'));
  subbar.appendChild(btnData);
  subbar.appendChild(btnStruct);
  subbar.appendChild(btnDdl);

  const dataPane = el('div', 'pane');
  const bar = el('div', 'editor-toolbar');
  const refreshBtn = el('button', 'run', '↻ 刷新');
  const addBtn = el('button', 'tb', '＋ 新增行');
  const saveBtn = el('button', 'run', '保存');
  const csvBtn = el('button', 'tb', '导出 CSV');
  const prevBtn = el('button', 'tb', '‹ 上一页');
  const nextBtn = el('button', 'tb', '下一页 ›');
  const filterInput = el('input', 'filter-input');
  filterInput.placeholder = '筛选，如 age > 30';
  const applyFilter = el('button', 'tb', '筛选');
  const clearFilter = el('button', 'tb', '清除');
  const hint = el('span', 'hint', '点击单元格直接编辑');
  [refreshBtn, addBtn, saveBtn, csvBtn, prevBtn, nextBtn].forEach((b) => bar.appendChild(b));
  bar.appendChild(filterInput);
  bar.appendChild(applyFilter);
  bar.appendChild(clearFilter);
  bar.appendChild(hint);

  const body = el('div', 'data-body');
  const gridArea = el('div', 'data-grid-area');
  const meta = el('div', 'results-meta', '加载中…');
  const gridWrap = el('div', 'results-grid');
  const infoPanel = el('div', 'table-info');
  gridArea.appendChild(meta);
  gridArea.appendChild(gridWrap);
  body.appendChild(gridArea);
  body.appendChild(infoPanel);
  dataPane.appendChild(bar);
  dataPane.appendChild(body);

  const structPane = el('div', 'pane hidden');
  const structMeta = el('div', 'results-meta', '');
  const structWrap = el('div', 'results-grid');
  structPane.appendChild(structMeta);
  structPane.appendChild(structWrap);

  const ddlPane = el('div', 'pane hidden');
  const ddlPre = el('pre', 'ddl-view', '');
  ddlPane.appendChild(ddlPre);

  tab.el.appendChild(subbar);
  tab.el.appendChild(dataPane);
  tab.el.appendChild(structPane);
  tab.el.appendChild(ddlPane);

  tab.subData = btnData;
  tab.subStruct = btnStruct;
  tab.subDdl = btnDdl;
  tab.dataPane = dataPane;
  tab.structPane = structPane;
  tab.ddlPane = ddlPane;
  tab.ddlPre = ddlPre;
  tab.meta = meta;
  tab.gridWrap = gridWrap;
  tab.infoPanel = infoPanel;
  tab.structMeta = structMeta;
  tab.structWrap = structWrap;
  tab.columns = [];
  tab.pk = null;
  tab.rows = [];
  tab.page = 1;
  tab.pageSize = 200;
  tab.total = 0;
  tab.sortCol = null;
  tab.sortDir = 'asc';
  tab.filter = '';
  tab.filterInput = filterInput;
  tab.prevBtn = prevBtn;
  tab.nextBtn = nextBtn;

  refreshBtn.addEventListener('click', () => loadData(tab));
  addBtn.addEventListener('click', () => addRow(tab));
  saveBtn.addEventListener('click', () => saveEdits(tab));
  csvBtn.addEventListener('click', () => exportCsv(tab));
  prevBtn.addEventListener('click', () => { if (tab.page > 1) { tab.page--; loadData(tab); } });
  nextBtn.addEventListener('click', () => { if (tab.page * tab.pageSize < tab.total) { tab.page++; loadData(tab); } });
  applyFilter.addEventListener('click', () => { tab.filter = filterInput.value.trim(); tab.page = 1; loadData(tab); });
  clearFilter.addEventListener('click', () => { filterInput.value = ''; tab.filter = ''; tab.page = 1; loadData(tab); });
  filterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { tab.filter = filterInput.value.trim(); tab.page = 1; loadData(tab); } });

  activateTab(tab.id);
  loadData(tab);
  loadStructure(tab);
  return tab;
}

function switchSubTab(tab, which) {
  tab.subData.classList.toggle('active', which === 'data');
  tab.subStruct.classList.toggle('active', which === 'structure');
  tab.subDdl.classList.toggle('active', which === 'ddl');
  tab.dataPane.classList.toggle('hidden', which !== 'data');
  tab.structPane.classList.toggle('hidden', which !== 'structure');
  tab.ddlPane.classList.toggle('hidden', which !== 'ddl');
  if (which === 'ddl') loadDdl(tab);
}

async function loadDdl(tab) {
  const resp = await window.api.ddl(tab.connId, tab.table);
  tab.ddlPre.textContent = (resp && resp.ok) ? (resp.ddl || '（无 DDL）') : ('错误：' + ((resp && resp.error) || '加载失败'));
}

async function loadData(tab) {
  tab.meta.className = 'results-meta';
  tab.meta.textContent = '加载中…';
  const offset = (tab.page - 1) * tab.pageSize;
  const resp = await window.api.tableData(tab.connId, tab.table, tab.pageSize, offset, tab.filter);
  if (resp.error) {
    tab.meta.className = 'results-meta err';
    tab.meta.textContent = '错误：' + resp.error;
    tab.gridWrap.innerHTML = '';
    return;
  }
  const info = await window.api.tableInfo(tab.connId, tab.table);
  tab.columns = resp.columns;
  tab.pk = (info && info.ok && info.primaryKey && info.primaryKey.length === 1) ? info.primaryKey[0] : null;
  tab.rows = resp.rows.map((r) => ({ orig: r.slice(), cur: r.slice(), state: 'clean' }));
  tab.total = resp.total;
  const totalPages = Math.max(1, Math.ceil(resp.total / tab.pageSize));
  tab.meta.className = 'results-meta ok';
  tab.meta.textContent = '共 ' + resp.total + ' 行 · 第 ' + tab.page + '/' + totalPages + ' 页' + (tab.pk ? ' · 可编辑' : ' · 只读');
  tab.prevBtn.disabled = tab.page <= 1;
  tab.nextBtn.disabled = tab.page >= totalPages;
  renderDataGrid(tab);
  renderTableInfo(tab);
}

function renderDataGrid(tab) {
  const wrap = tab.gridWrap;
  wrap.innerHTML = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', 'rownum', ''));
  hr.appendChild(el('th', 'rownum', '#'));
  tab.columns.forEach((c) => {
    const th = el('th', 'sortable', c);
    if (tab.sortCol === c) th.textContent = c + (tab.sortDir === 'asc' ? ' ▲' : ' ▼');
    th.addEventListener('click', () => sortData(tab, c));
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  tab.rows.forEach((row, ri) => {
    const tr = el('tr');
    if (row.state === 'deleted') tr.classList.add('row-deleted');
    const tdDel = el('td', 'rownum');
    const delBtn = el('button', 'row-del', '×');
    delBtn.title = '删除/恢复该行';
    delBtn.addEventListener('click', () => {
      row.state = (row.state === 'deleted') ? 'edited' : 'deleted';
      tr.classList.toggle('row-deleted', row.state === 'deleted');
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tr.appendChild(el('td', 'rownum', String(ri + 1)));
    row.cur.forEach((v, ci) => {
      const td = el('td');
      const input = el('input', 'cell-input');
      input.value = (v === null || v === undefined) ? '' : String(v);
      input.addEventListener('input', () => {
        row.cur[ci] = input.value;
        if (row.state === 'clean') row.state = 'edited';
      });
      td.appendChild(input);
      td.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); showCellContextMenu(ev, row, ci); });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function sortData(tab, col) {
  const ci = tab.columns.indexOf(col);
  if (ci < 0) return;
  if (tab.sortCol === col) {
    tab.sortDir = tab.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    tab.sortCol = col;
    tab.sortDir = 'asc';
  }
  tab.rows.sort((a, b) => {
    const av = a.cur[ci], bv = b.cur[ci];
    const an = Number(av), bn = Number(bv);
    const aNum = av !== '' && av !== null && av !== undefined && !isNaN(an);
    const bNum = bv !== '' && bv !== null && bv !== undefined && !isNaN(bn);
    let cmp;
    if (aNum && bNum) cmp = an - bn;
    else cmp = String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv));
    return tab.sortDir === 'asc' ? cmp : -cmp;
  });
  renderDataGrid(tab);
}

function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  ta.remove();
  setStatus('已复制', '');
}

function showCellContextMenu(e, row, ci) {
  closeContextMenu();
  const menu = el('div', 'ctx-menu');
  const cell = el('div', 'ctx-item', '复制单元格值');
  cell.addEventListener('click', () => { closeContextMenu(); copyText(row.cur[ci] == null ? '' : String(row.cur[ci])); });
  const rowItem = el('div', 'ctx-item', '复制整行（TSV）');
  rowItem.addEventListener('click', () => { closeContextMenu(); copyText(row.cur.map((v) => v == null ? '' : String(v)).join('\t')); });
  menu.appendChild(cell);
  menu.appendChild(rowItem);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
  document.addEventListener('contextmenu', closeContextMenu, { once: true });
}

function renderTableInfo(tab) {
  const p = tab.infoPanel;
  if (!p) return;
  p.innerHTML = '';
  p.appendChild(el('div', 'ti-title', tab.table));
  p.appendChild(el('div', 'ti-meta', '共 ' + (tab.total || 0) + ' 行'));
  const cols = (tab.colInfo && tab.colInfo.length) ? tab.colInfo : tab.columns.map((name) => ({ name, type: '', pk: false }));
  p.appendChild(el('div', 'ti-head', '字段（' + cols.length + '）'));
  const colList = el('div', 'ti-list');
  cols.forEach((c) => {
    const row = el('div', 'ti-row');
    row.appendChild(el('span', 'ti-mark', c.pk ? 'PK' : ''));
    row.appendChild(el('span', 'ti-col-name', c.name));
    row.appendChild(el('span', 'ti-col-type', c.type || ''));
    colList.appendChild(row);
  });
  p.appendChild(colList);
  if (tab.primaryKey && tab.primaryKey.length) {
    p.appendChild(el('div', 'ti-head', '主键'));
    p.appendChild(el('div', 'ti-meta', tab.primaryKey.join(', ')));
  }
}

async function loadStructure(tab) {
  tab.structMeta.className = 'results-meta';
  tab.structMeta.textContent = '加载中…';
  const info = await window.api.tableInfo(tab.connId, tab.table);
  if (!info || info.error) {
    tab.structMeta.className = 'results-meta err';
    tab.structMeta.textContent = '错误：' + (info && info.error ? info.error : '加载失败');
    tab.structWrap.innerHTML = '';
    return;
  }
  tab.structMeta.className = 'results-meta ok';
  tab.structMeta.textContent = '字段 ' + info.columns.length + ' 个，索引 ' + info.indexes.length + ' 个';
  tab.colInfo = info.columns;
  tab.indexes = info.indexes;
  tab.primaryKey = info.primaryKey;
  renderTableInfo(tab);
  tab.structWrap.innerHTML = '';

  const colsTitle = el('div', 'struct-title', '字段');
  tab.structWrap.appendChild(colsTitle);
  const ct = el('table', 'grid');
  const chead = el('thead');
  const chr = el('tr');
  ['#', '字段名', '类型', '非空', '主键', '默认值'].forEach((h) => chr.appendChild(el('th', null, h)));
  chead.appendChild(chr);
  ct.appendChild(chead);
  const cbody = el('tbody');
  info.columns.forEach((c, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'rownum', String(i + 1)));
    tr.appendChild(el('td', null, c.name));
    tr.appendChild(el('td', null, c.type));
    tr.appendChild(el('td', null, c.notnull ? '是' : '否'));
    tr.appendChild(el('td', null, c.pk ? '★' : ''));
    tr.appendChild(el('td', null, c.dflt == null ? '' : String(c.dflt)));
    cbody.appendChild(tr);
  });
  ct.appendChild(cbody);
  tab.structWrap.appendChild(ct);

  if (info.indexes && info.indexes.length) {
    const idxTitle = el('div', 'struct-title', '索引');
    tab.structWrap.appendChild(idxTitle);
    const it = el('table', 'grid');
    const ihead = el('thead');
    const ihrow = el('tr');
    ['索引名', '唯一', '字段'].forEach((h) => ihrow.appendChild(el('th', null, h)));
    ihead.appendChild(ihrow);
    it.appendChild(ihead);
    const ibody = el('tbody');
    info.indexes.forEach((ix) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, ix.name));
      tr.appendChild(el('td', null, ix.unique ? '是' : '否'));
      tr.appendChild(el('td', null, ix.columns || ''));
      ibody.appendChild(tr);
    });
    it.appendChild(ibody);
    tab.structWrap.appendChild(it);
  }
}

function addRow(tab) {
  const cols = tab.columns.length || 1;
  tab.rows.push({ orig: new Array(cols).fill(null), cur: new Array(cols).fill(''), state: 'new' });
  renderDataGrid(tab);
  tab.gridWrap.scrollTop = tab.gridWrap.scrollHeight;
}

async function saveEdits(tab) {
  if (!tab.pk) { setStatus('该表无单一主键，无法编辑保存', ''); return; }
  const conn = connById(tab.connId);
  if (!conn) return;
  const pkIdx = tab.columns.indexOf(tab.pk);
  const tbl = qIdent(conn, tab.table);
  const statements = [];
  for (const row of tab.rows) {
    if (row.state === 'deleted') {
      const pkVal = row.orig[pkIdx];
      statements.push({ sql: 'DELETE FROM ' + tbl + ' WHERE ' + qIdent(conn, tab.pk) + ' = ?', params: [pkVal] });
    } else if (row.state === 'edited') {
      const sets = [];
      const params = [];
      for (let ci = 0; ci < tab.columns.length; ci++) {
        if (String(row.cur[ci]) !== String(row.orig[ci])) {
          sets.push(qIdent(conn, tab.columns[ci]) + ' = ?');
          params.push(row.cur[ci]);
        }
      }
      if (sets.length) {
        params.push(row.orig[pkIdx]);
        statements.push({ sql: 'UPDATE ' + tbl + ' SET ' + sets.join(', ') + ' WHERE ' + qIdent(conn, tab.pk) + ' = ?', params });
      }
    } else if (row.state === 'new') {
      const cols = [];
      const vals = [];
      for (let ci = 0; ci < tab.columns.length; ci++) {
        const v = row.cur[ci];
        if (v !== '' && v !== null && v !== undefined) {
          cols.push(qIdent(conn, tab.columns[ci]));
          vals.push(v);
        }
      }
      if (cols.length) {
        statements.push({ sql: 'INSERT INTO ' + tbl + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', params: vals });
      }
    }
  }
  if (!statements.length) { setStatus('没有需要保存的修改', ''); return; }
  let err = null;
  for (const s of statements) {
    const resp = await window.api.execute(tab.connId, s.sql, s.params);
    if (resp && resp.error) { err = resp.error; break; }
  }
  if (err) { setStatus('保存失败：' + err, ''); }
  else { setStatus('已保存', ''); await loadData(tab); }
}

async function exportCsv(tab) {
  const header = tab.columns.map(csvEscape).join(',');
  const lines = tab.rows.filter((r) => r.state !== 'deleted').map((r) => r.cur.map(csvEscape).join(','));
  const csv = [header].concat(lines).join('\r\n');
  const resp = await window.api.exportCsv({ csv, defaultName: tab.table + '.csv' });
  if (resp && resp.ok) setStatus('已导出到 ' + resp.path, '');
  else if (resp && resp.error) setStatus('导出失败：' + resp.error, '');
}

/* ================= sidebar ================= */