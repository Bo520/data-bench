# NavicatLocal

完全本地运行的数据库管理工具（Navicat 简化版），基于 Electron 开发。

## 功能

- **支持 5 种数据库**：SQLite / MySQL / MariaDB / PostgreSQL / SQL Server
- **连接管理**：连接树（库/表/视图分组）、连接保存与一键重连、表行数统计
- **数据浏览与编辑**：分页、筛选、点表头排序、单元格编辑（需单一主键）、复制单元格/整行
- **表操作**：可视化建表、表结构查看、DDL 查看、复制表、重命名、清空、删除
- **SQL 编辑器**：语法高亮、关键字/表/字段自动补全、SQL 格式化、查询历史、代码片段、运行选中 SQL
- **查询结果图表**（横向柱状图）
- **导入导出**：CSV 导入、CSV / JSON / SQL / Excel(.xlsx) 导出
- **高级功能**：数据传输（跨库）、结构对比与同步、数据生成器、用户管理（MySQL）、查询构建器、计划任务、ER 图（外键连线）
- **服务器监控**、备份为 SQL、恢复 SQL 文件
- 浅色 Navicat 风格界面

## 技术栈

- [Electron](https://www.electronjs.org/)
- [sql.js](https://github.com/sql-js/sql.js)（SQLite，WASM）
- [mysql2](https://github.com/sidorares/node-mysql2)（MySQL / MariaDB）
- [pg](https://github.com/brianc/node-postgres)（PostgreSQL）
- [mssql](https://github.com/tediousjs/node-mssql)（SQL Server，基于 tedious）
- [xlsx](https://github.com/SheetJS/sheetjs)（Excel 导出）

## 运行

```bash
npm install
npm install --save-dev electron
npm start
```

## 打包（Windows）

```bash
npm install --save-dev electron-packager
npm run dist
```

## 目录结构

```
navicat-local/
├── main.js        # 主进程（IPC、数据库驱动）
├── preload.js     # 预加载脚本（contextBridge）
├── renderer/      # 渲染进程（界面）
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── installer.nsi  # NSIS 安装包脚本（APPDIR 需按需修改）
└── package.json
```

## 说明

- 数据库连接配置（含密码）保存在本地 localStorage（`savedConnections`），仅本机存储。
- 计划任务仅在应用运行期间生效。
- 表数据编辑依赖单一主键；无单一主键的表为只读。
- `installer.nsi` 中的 `APPDIR` 与 `OutFile` 需改成你自己的目录。

## License

MIT
