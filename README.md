# DataBench

完全本地运行的数据库管理工具，基于 Electron 开发。

## 功能

- **支持 5 种数据库**：SQLite / MySQL / MariaDB / PostgreSQL / SQL Server
- **连接管理**：单一连接树（已保存 / 最近 / 已打开合并）、连接分组（新建 / 重命名 / 删除、拖拽连接进分组）、一键重连
- **数据浏览与编辑**：分页、筛选、点表头排序、单元格编辑（需单一主键）、复制单元格 / 整行
- **数据库页签**：打开数据库显示表 / 视图列表，支持批量勾选删除表
- **表操作**：可视化建表、表结构查看、DDL 查看、复制表、重命名、清空、删除
- **SQL 编辑器**：语法高亮、关键字 / 表 / 字段自动补全、SQL 格式化、查询历史、代码片段、运行选中 SQL
- **查询结果图表**（横向柱状图）
- **导入导出**：CSV 导入、CSV / JSON / SQL / Excel(.xlsx) 导出
- **高级功能**：数据传输（跨库）、结构对比与同步、数据生成器、用户管理（MySQL）、查询构建器、计划任务、ER 图（外键连线）
- **服务器监控**、备份为 SQL、恢复 SQL 文件
- **检查更新**：基于 GitHub Releases API；帮助菜单支持查看版本信息、检查更新、跳转 GitHub
- 浅色界面

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
data-bench/
├── main.js        # 主进程入口（窗口、IPC 注册、连接生命周期）
├── preload.js     # 预加载脚本（contextBridge）
├── lib/
│   ├── utils.js   # 标识符引用、CSV 解析、结果集转换、显示名
│   └── drivers.js # MySQL/PG/MSSQL/SQLite 元数据读取
├── renderer/      # 渲染进程（界面）
│   ├── index.html
│   ├── styles.css
│   └── js/        # 按职责拆分的渲染层模块
│       ├── 00-core.js        状态、工具、弹窗辅助
│       ├── 10-tabs.js        页签管理、网格、图表
│       ├── 20-editor.js      SQL 高亮、自动补全、历史、片段
│       ├── 30-table.js       查询/表页签、数据编辑
│       ├── 40-tree.js        连接树、分组、拖拽
│       ├── 50-connections.js 连接对话框、右键菜单、检查更新
│       ├── 60-features.js    数据传输/对比/生成器/用户/构建器/计划任务/ER图
│       ├── 70-database.js    建库、编辑库、建表设计器
│       └── 90-init.js        初始化与事件绑定
├── installer.nsi  # NSIS 安装包脚本（APPDIR 需按需修改）
└── package.json
```

## 说明

- 数据库连接配置（含密码）保存在本地 localStorage（`savedConnections`），仅本机存储。
- 计划任务仅在应用运行期间生效。
- 表数据编辑依赖单一主键；无单一主键的表为只读。
- `installer.nsi` 中的 `APPDIR` 与 `OutFile` 需改成你自己的目录。

## 声明

本项目与 Navicat / PremiumSoft CyberTech Ltd. 无任何关联，不包含其任何代码、图标或资源。

## License

MIT
