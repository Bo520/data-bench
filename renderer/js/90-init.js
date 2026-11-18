// ===== DataBench renderer: init & event wiring =====
'use strict';
function init() {
  // welcome pane
  welcomeEl = welcomePane();
  $('#tabcontent').appendChild(welcomeEl);

  $('#btn-new-conn').addEventListener('click', newConnection);
  $('#btn-new-conn-top').addEventListener('click', newConnection);
  $('#ct-sqlite-open').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); openFile(); });
  $('#ct-sqlite-new').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); createFile(); });
  $('#ct-mysql').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); mysqlConnect(); });
  $('#ct-pg').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); pgConnect(); });
  $('#ct-mssql').addEventListener('click', () => { $('#conn-type-modal').classList.add('hidden'); mssqlConnect(); });
  $('#ct-cancel').addEventListener('click', () => $('#conn-type-modal').classList.add('hidden'));
  $('#m-connect').addEventListener('click', submitMysqlConnect);
  $('#m-cancel').addEventListener('click', () => $('#mysql-modal').classList.add('hidden'));
  $('#m-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMysqlConnect(); });
  $('#pg-connect').addEventListener('click', submitPgConnect);
  $('#pg-cancel').addEventListener('click', () => $('#pg-modal').classList.add('hidden'));
  $('#pg-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPgConnect(); });
  $('#ms-connect').addEventListener('click', submitMssqlConnect);
  $('#ms-cancel').addEventListener('click', () => $('#mssql-modal').classList.add('hidden'));
  $('#ms-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMssqlConnect(); });
  $('#m-test').addEventListener('click', testMysql);
  $('#pg-test').addEventListener('click', testPg);
  $('#ms-test').addEventListener('click', testMssql);
  $('#db-ok').addEventListener('click', submitCreateDatabase);
  $('#db-cancel').addEventListener('click', () => $('#db-modal').classList.add('hidden'));
  $('#db-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCreateDatabase(); });
  $('#tr-ok').addEventListener('click', submitDataTransfer);
  $('#tr-cancel').addEventListener('click', () => $('#transfer-modal').classList.add('hidden'));
  $('#cmp-ok').addEventListener('click', submitStructureCompare);
  $('#cmp-cancel').addEventListener('click', () => $('#cmp-modal').classList.add('hidden'));
  $('#gen-ok').addEventListener('click', submitDataGenerator);
  $('#gen-cancel').addEventListener('click', () => $('#gen-modal').classList.add('hidden'));
  $('#cu-ok').addEventListener('click', submitCreateUser);
  $('#cu-cancel').addEventListener('click', () => $('#cu-modal').classList.add('hidden'));
  $('#qb-ok').addEventListener('click', submitQueryBuilder);
  $('#qb-cancel').addEventListener('click', () => $('#qb-modal').classList.add('hidden'));
  $('#qb-table').addEventListener('change', () => { const c = connById(qbConnId); if (c) loadQbColumns(c, $('#qb-table').value); });
  $('#task-ok').addEventListener('click', submitNewTask);
  $('#task-cancel').addEventListener('click', () => $('#task-modal').classList.add('hidden'));
  setInterval(() => {
    const now = Date.now();
    const list = loadTasks();
    list.forEach((t) => {
      if (t.lastRun && now - t.lastRun < t.interval * 60000) return;
      if (!connById(t.connId)) return;
      t.lastRun = now;
      saveTasks(list);
      window.api.query(t.connId, t.sql).then((resp) => {
        t.lastResult = (resp && resp.error) ? '错误' : '成功';
        saveTasks(list);
      });
    });
  }, 30000);
  $('#td-add-col').addEventListener('click', () => addDesignerRow({}));
  $('#td-create').addEventListener('click', createTable);
  $('#td-cancel').addEventListener('click', () => $('#table-designer-modal').classList.add('hidden'));
  $('#btn-save').addEventListener('click', saveActive);
  $('#btn-query').addEventListener('click', () => {
    if (!state.activeId) { setStatus('请先打开一个数据库连接', ''); return; }
    openQueryTab(state.activeId);
  });
  $('#conn-select').addEventListener('change', (e) => {
    state.activeId = Number(e.target.value) || null;
    refreshConnSelect();
    const c = activeConn();
    setStatus(c ? c.name : '', c ? connSubtitle(c) : '');
  });
  $('#btn-check-update').addEventListener('click', checkUpdate);
  $('#update-close').addEventListener('click', () => $('#update-modal').classList.add('hidden'));
  $('#update-download').addEventListener('click', () => {
    const url = $('#update-download').dataset.url;
    if (url) window.api.openExternal(url);
    $('#update-modal').classList.add('hidden');
  });

  refreshConnSelect();
  buildTree();
  initSidebarResizer();
  $('#tree').addEventListener('contextmenu', (e) => {
    if (e.target === $('#tree') || (e.target.classList && e.target.classList.contains('tree-empty'))) {
      e.preventDefault();
      e.stopPropagation();
      showTreeContextMenu(e);
    }
  });
  document.addEventListener('mousedown', (e) => { if (acBox && !acBox.contains(e.target)) closeAutocomplete(); if (histBox && !histBox.contains(e.target)) closeQueryHistory(); if (snipBox && !snipBox.contains(e.target)) closeSnippets(); });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); newConnection(); }
    else if (k === 'q') { e.preventDefault(); if (state.activeId) openQueryTab(state.activeId); }
    else if (k === 's') { e.preventDefault(); saveActive(); }
    else if (k === 'f4') { e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); }
  });
  setStatus('就绪', '完全本地运行');
}

init();