# 海外利益保护情报预警平台 - PostgreSQL 版部署指南

## 目录结构

```
项目根目录/
├── server/            ← 后端服务
│   ├── server.js      ← Express.js 主服务器（40+ API端点）
│   ├── db.js          ← PostgreSQL 连接池（慢查询日志）
│   ├── init.sql       ← 数据库 DDL（12个数据表）
│   ├── package.json   ← Node.js 依赖（bcrypt/cors/dotenv/express/jsonwebtoken/pg）
│   ├── .env           ← 环境变量（需修改）
│   ├── .env.example   ← 环境变量示例
│   ├── DEPLOY.md      ← 本部署指南
│   └── scripts/
│       ├── init-db.js      ← 数据库初始化脚本（建表+管理员账号）
│       └── import-data.js  ← localStorage→PostgreSQL 数据迁移脚本
├── api-client.js      ← 前端 API 客户端桥接层（离线回退到localStorage）
├── app.js             ← 前端主应用（AUTH/DataHub/INTELCENTER/DBCenter/SETTINGS API同步）
├── autoalert.js       ← 预警模块（_loadFromAPI + _syncAPI）
├── threats.js         ← 威胁评估模块（THREAT_ASSESS/THREAT_CUSTOM API同步）
├── scraper.js         ← 采集模块（COLLECTED_DB/ENTERPRISE_DB/RISK_FUSION/THREAT_ORGS_DB API同步）
├── export-localstorage.html ← 浏览器端 localStorage 数据导出工具
├── index.html         ← 前端页面（已添加 api-client.js 引用）
└── ...其他前端文件
```

## 一、安装 PostgreSQL

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### CentOS/RHEL
```bash
sudo yum install postgresql-server postgresql-contrib
sudo postgresql-setup initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 宝塔面板
在宝塔面板 → 软件商店 → 搜索 PostgreSQL → 安装

## 二、创建数据库和用户

```bash
# 切换到 postgres 用户
sudo -u postgres psql

# 创建数据库用户
CREATE USER orps_user WITH PASSWORD 'your_secure_password_here';

# 创建数据库
CREATE DATABASE orps_db OWNER orps_user;

# 授权
GRANT ALL PRIVILEGES ON DATABASE orps_db TO orps_user;

# 退出
\q
```

## 三、修改 .env 配置

编辑 `server/.env` 文件，填入实际配置：

```
DB_HOST=localhost          # PostgreSQL 地址
DB_PORT=5432              # PostgreSQL 端口
DB_NAME=orps_db           # 数据库名
DB_USER=orps_user         # 数据库用户名
DB_PASS=你的实际密码       # 数据库密码（必须修改！）

JWT_SECRET=修改为随机密钥   # JWT 签名密钥（至少32字符，必须修改！）
JWT_EXPIRES_IN=24h         # 登录有效期

PORT=3000                  # 后端服务端口
NODE_ENV=production        # 生产环境

CORS_ORIGIN=https://你的域名  # 前端域名（CORS 白名单）
```

**⚠️ 重要：必须修改 DB_PASS 和 JWT_SECRET！**

## 四、初始化数据库

```bash
cd server

# 安装依赖（如果尚未安装）
npm install

# 初始化数据库表结构
node scripts/init-db.js
```

此脚本会：
- 创建所有数据表
- 创建默认管理员账号 (admin / admin123)
- **请及时修改 admin 密码！**

## 五、启动后端服务

### 开发模式
```bash
cd server
node server.js
# 或使用 --watch 自动重启
node --watch server.js
```

### 生产模式 (PM2)
```bash
# 安装 PM2
npm install -g pm2

# 启动服务
cd server
pm2 start server.js --name orps-backend

# 查看状态
pm2 status

# 查看日志
pm2 logs orps-backend

# 重启
pm2 restart orps-backend

# 设置开机自启
pm2 startup
pm2 save
```

## 六、配置 Nginx 反向代理

创建 Nginx 配置文件 `/etc/nginx/conf.d/orps.conf`：

```nginx
server {
    listen 80;
    server_name 你的域名.com;

    # 前端静态文件
    root /www/wwwroot/orps;    # 项目根目录
    index index.html;

    # API 请求转发到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
    }

    # 前端路由（SPA 模式）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket（如果需要）
    location /ws/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

然后：
```bash
# 检查配置
sudo nginx -t

# 重载配置
sudo nginx -s reload
```

### 宝塔面板配置
在宝塔面板 → 网站 → 添加站点 → 设置反向代理：
- 目标URL: `http://127.0.0.1:3000`
- 发送域名: `$host`
- 只代理 `/api/` 路径

## 七、SSL/HTTPS 配置

```bash
# 使用 Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名.com
```

或在宝塔面板 → 网站 → SSL → 申请免费证书

## 八、数据迁移（localStorage → PostgreSQL）

如果系统已有 localStorage 数据，需要迁移。分为两步：**浏览器端导出** + **服务器端导入**。

### 第一步：浏览器端导出

1. 用浏览器打开系统，在地址栏输入导出工具页面路径：
   ```
   https://你的域名.com/export-localstorage.html
   ```
   （或将 `export-localstorage.html` 文件放到服务器项目根目录下访问）

2. 点击 **"导出数据"** 按钮，系统会自动扫描所有 `orps_` 前缀的 localStorage 数据

3. 点击 **"下载 JSON 文件"**，将导出的 `orps-data-backup.json` 文件保存到本地

4. 将该文件上传到服务器 `server/scripts/` 目录下

### 第二步：服务器端导入

```bash
cd server/scripts

# 确保 data.backup.json 文件已放置在此目录
# 运行迁移脚本（7个步骤：用户→情报→DataHub→AI报告→威胁组织→企业项目→风险融合/预警/评估）
node import-data.js
```

脚本会：
- 使用事务（BEGIN/COMMIT）确保数据一致性
- 用户密码通过 bcrypt 重新哈希（从明文 → 安全哈希）
- 使用 ON CONFLICT DO UPDATE 处理重复数据
- 每个步骤都有进度日志输出

### 方法3：系统自动同步（新用户）
新系统会在用户登录后自动从 API 加载数据。
如果不需要迁移旧数据，可直接注册新账号使用。

## 九、前端配置后端地址

### 同源部署（推荐）
前端和后端部署在同一域名下，Nginx 负责：
- `/api/*` → 后端 Node.js (端口 3000)
- 其他路径 → 静态文件

此时 `api-client.js` 自动检测 `window.location.origin`，无需额外配置。

### 跨域部署
如果前端和后端不在同一域名，需手动设置后端地址。
在 `index.html` 的 `<script>` 标签前添加：

```html
<script>
// 手动设置后端地址
APIClient_INIT_URL = 'https://你的后端域名:3000';
</script>
<script src="api-client.js?v=1"></script>
```

并修改 `api-client.js` 的 init 方法读取该变量：
```javascript
init: function(baseUrl) {
  if (baseUrl) this._baseUrl = baseUrl;
  else if (typeof APIClient_INIT_URL !== 'undefined') this._baseUrl = APIClient_INIT_URL;
  else this._baseUrl = window.location.origin;
  ...
}
```

## 十、系统运行

1. 启动 PostgreSQL：`sudo systemctl start postgresql`
2. 启动后端服务：`pm2 start server.js --name orps-backend`
3. 启动 Nginx：`sudo systemctl start nginx`
4. 访问网站：`https://你的域名.com`

## 常见问题

### Q: 后端启动报 "连接失败" 错误？
- 检查 PostgreSQL 是否运行：`sudo systemctl status postgresql`
- 检查 .env 中的 DB_HOST/DB_PORT/DB_USER/DB_PASS 是否正确
- 检查 pg_hba.conf 允许本地连接

### Q: 前端显示 "后端不可达"？
- 检查后端是否启动：`curl http://localhost:3000/api/health`
- 检查 Nginx 反向代理配置
- 检查 CORS_ORIGIN 是否匹配前端域名

### Q: 登录时提示 "密码错误"？
- admin 默认密码为 admin123
- 服务器端密码使用 bcrypt 加密，与 localStorage 明文不同
- 需要先通过 API 注册/登录

### Q: 旧数据如何迁移？
- 参考"数据迁移"章节
- 系统支持离线模式：无后端时自动回退到 localStorage

### Q: 如何修改 admin 密码？
```bash
# 在服务器上执行
cd server
node -e "
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();
const pool = new Pool();
bcrypt.hash('新密码', 10).then(h => {
  pool.query('UPDATE users SET password = \$1 WHERE username = \$2', [h, 'admin'])
    .then(() => { console.log('密码已更新'); pool.end(); });
});
"
```
