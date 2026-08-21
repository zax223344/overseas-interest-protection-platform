# 海外利益保护情报预警平台 — PostgreSQL 迁移完成报告

## 项目概述

将海外利益保护情报预警平台从纯前端 localStorage 存储架构，完整迁移到 **PostgreSQL 后端数据库 + Express.js API 服务器** 的前后端分离架构。

---

## 已完成的工作清单

### 一、后端服务（server/）

| 文件 | 说明 | 行数 |
|------|------|------|
| `server.js` | Express.js 主服务器，40+ RESTful API 端点 | ~492 |
| `db.js` | PostgreSQL 连接池（pg 模块），慢查询>100ms自动日志 | ~55 |
| `init.sql` | 数据库 DDL，12 个数据表定义 | ~270 |
| `package.json` | 6 个核心依赖：bcrypt, cors, dotenv, express, jsonwebtoken, pg | - |
| `.env / .env.example` | 数据库连接配置 + JWT 密钥 | - |
| `DEPLOY.md` | 完整部署指南文档 | ~300 |

**数据库表（12个）：**
1. `users` — 用户账号（bcrypt 密码哈希、角色、审批状态、试用过期时间）
2. `intel_data` — 情报数据（11类+日志）
3. `datahub_store` — DataHub 数据仓库（12个集合）
4. `ai_reports` — AI 报告（4种模式、三字段分离）
5. `threat_orgs` — 威胁组织库
6. `enterprise_projects` — 企业项目
7. `risk_fusion` — 风险融合数据
8. `auto_alerts` — 自动预警
9. `audit_logs` — 审计日志
10. `threat_assessments` — 威胁评估（assess/custom 双类型）
11. `user_settings` — 用户个性化设置
12. `collected_data` — 采集数据（按类别存储）

**API 端点（40+）：**
- 认证：login / register / trial / renew-trial / check
- 用户管理：list / approve / reject / role / delete / password
- 情报数据：CRUD + batch + audit + clear
- DataHub：get / save
- AI报告：CRUD + list
- 威胁组织/企业项目/风险融合/自动预警：get / save
- 审计日志/威胁评估/采集数据/用户设置：CRUD

### 二、前端 API 桥接层（api-client.js）

| 方法 | 说明 |
|------|------|
| `init(baseUrl)` | 初始化，自动探测后端可用性 |
| `isOnline()` | 后端是否在线 |
| `_fetch(method, path, body, noAuth)` | 统一请求方法（JWT 自动附带） |
| `login / register / checkAuth / logout` | 认证流程 |
| `listUsers / approveUser / rejectUser / deleteUser` | 用户管理 |
| `addIntel / addIntelBatch / deleteIntel / deleteAllIntel` | 情报数据 |
| `getDataHub / saveDataHub` | DataHub |
| `listReports / createReport / updateReport / deleteReport` | AI报告 |
| `getThreatOrgs / saveThreatOrgs` | 威胁组织 |
| `getEnterpriseProjects / saveEnterpriseProjects` | 企业项目 |
| `getRiskFusion / saveRiskFusion` | 风险融合 |
| `getAutoAlerts / saveAutoAlerts` | 自动预警 |
| `saveThreatAssessments` | 威胁评估 |
| `getCollected / saveCollected` | 采集数据 |
| `createTrial / renewTrial` | 试用账号 |

**核心设计：**
- API 优先 + localStorage 离线回退
- 当后端不可达时，系统自动回退到本地存储，保证可用性
- JWT Token 自动管理和持久化

### 三、前端模块 API 同步改造

| 模块 | 文件 | 改造内容 |
|------|------|----------|
| AUTH | app.js | 登录/注册/审批/试用账号 → 全部走 API |
| DBCenter | app.js | 情报数据添加/批量添加 → API + localStorage |
| DataHub | app.js | 12个集合读取/保存 → API优先加载 + 双写 |
| INTELCENTER | app.js | AI报告CRUD → API + localStorage |
| SETTINGS | app.js | 用户设置 → API |
| THREAT_ASSESS | threats.js | 威胁评估set/remove → `_syncAPI()` |
| THREAT_CUSTOM | threats.js | 自定义组织add/update/remove → `_syncAPI()` |
| AUTO_ALERT | autoalert.js | `_loadFromAPI()` + `_save()` 中API同步 |
| COLLECTED_DB | scraper.js | `_syncAPI(k,v)` + `_loadFromAPI()` 统一加载 |
| ENTERPRISE_DB | scraper.js | `_syncAPI(v)` 写入同步 |
| RISK_FUSION | scraper.js | `_syncAPI(v)` 写入同步 |
| THREAT_ORGS_DB | scraper.js | `_save(all)` 统一写入 + `_syncAPI(all)` |

**统一设计模式：**
```javascript
// 所有模块遵循相同的 API 同步模式：
_syncAPI(data) {
  if (typeof APIClient !== 'undefined' && APIClient.isOnline()) {
    APIClient.xxx(data).catch(function() {}); // 防止未捕获异常
  }
}

_loadFromAPI() {
  if (typeof APIClient === 'undefined' || !APIClient.isOnline()) return;
  APIClient.getXxx().then(function(data) {
    // 覆盖本地数据 + 重新渲染
  }).catch(function() {});
}
```

### 四、数据迁移工具

| 文件 | 说明 |
|------|------|
| `export-localstorage.html` | 浏览器端导出工具，扫描所有 `orps_` 前缀数据，按类别分组显示统计，支持下载JSON和复制到剪贴板 |
| `server/scripts/import-data.js` | 服务器端导入脚本，7步迁移（用户→情报→DataHub→报告→威胁→企业→融合/预警/评估），事务保护，bcrypt密码哈希 |

### 五、安全增强

- **密码存储**：从 localStorage 明文 → PostgreSQL + bcrypt 哈希
- **认证机制**：从 localStorage token → JWT (jsonwebtoken) 签名验证
- **API 权限**：authMiddleware（登录验证）+ adminOnly（管理员验证）
- **CORS 控制**：白名单限制前端域名

---

## 部署步骤（7步）

### 步骤1：安装 PostgreSQL
```bash
# Ubuntu
sudo apt update && sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql && sudo systemctl enable postgresql

# 宝塔面板：软件商店 → 搜索 PostgreSQL → 安装
```

### 步骤2：创建数据库
```bash
sudo -u postgres psql
CREATE USER orps_user WITH PASSWORD '你的密码';
CREATE DATABASE orps_db OWNER orps_user;
GRANT ALL PRIVILEGES ON DATABASE orps_db TO orps_user;
\q
```

### 步骤3：配置 .env
编辑 `server/.env`，修改 DB_PASS、JWT_SECRET、CORS_ORIGIN

### 步骤4：初始化数据库
```bash
cd server && npm install && node scripts/init-db.js
# 创建12个数据表 + 默认管理员账号 admin/admin123
```

### 步骤5：导出旧数据
浏览器访问 `export-localstorage.html` → 点击"导出数据" → 下载 `orps-data-backup.json`

### 步骤6：导入旧数据
```bash
# 将 orps-data-backup.json 上传到 server/scripts/ 目录
cd server/scripts && node import-data.js
# 7步迁移，事务保护
```

### 步骤7：启动服务 + 配置Nginx
```bash
# 启动后端
pm2 start server.js --name orps-backend

# Nginx 配置（/api/ → 后端3000端口，其他 → 静态文件）
# 参考 DEPLOY.md 中的 Nginx 配置模板
```

---

## 架构示意图

```
┌─────────────────────────────────────────────┐
│                  Nginx (80/443)              │
│                                             │
│  /api/*  ────→  Node.js Express (3000)      │
│                     │                        │
│               JWT 认证中间件                  │
│                     │                        │
│              PostgreSQL (5432)               │
│              └─ 12个数据表                    │
│                                             │
│  其他路径 ──→  静态前端文件                    │
│  ┌──────────────────────────┐               │
│  │  api-client.js (桥接层)   │               │
│  │  ├─ API优先              │               │
│  │  └─ localStorage回退     │               │
│  └──────────────────────────┘               │
└─────────────────────────────────────────────┘
```

---

## 语法验证结果

所有文件 `node -c` 语法检查通过：
- ✅ api-client.js
- ✅ app.js
- ✅ autoalert.js
- ✅ threats.js
- ✅ scraper.js
- ✅ server/server.js
- ✅ server/db.js
- ✅ server/scripts/import-data.js

---

## 未同步的模块（低优先级）

- `aireport.js` 中的 `_loadCart()` / `_saveCart()` — 素材收集篮数据，临时性，暂不强制同步到后端

---

## 文件修改总览

| 操作 | 文件 |
|------|------|
| 新建 | server/server.js, db.js, init.sql, package.json, .env, .env.example, .gitignore, DEPLOY.md |
| 新建 | server/scripts/init-db.js, import-data.js |
| 新建 | api-client.js, export-localstorage.html |
| 修改 | index.html（添加 api-client.js 引用） |
| 修改 | app.js（AUTH/DataHub/INTELCENTER/DBCenter/SETTINGS API同步） |
| 修改 | threats.js（THREAT_ASSESS/THREAT_CUSTOM _syncAPI） |
| 修改 | autoalert.js（_loadFromAPI + _save API同步） |
| 修改 | scraper.js（4个模块 _syncAPI + _loadFromAPI 统一加载） |
