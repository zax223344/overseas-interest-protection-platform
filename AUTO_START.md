# ORPS 7×24 小时自动采集部署说明

## 目标
- 不需要每次手动点击或依赖 WorkBuddy 触发。
- 电脑开机后自动启动 PostgreSQL + Node 后端 + 采集引擎。
- Node 后端崩溃或异常退出后，PM2 自动重启。
- 只要系统在线，数据就持续入库；下线期间只暂停采集，上线后立即恢复。

## 一、已安装的组件

| 组件 | 位置 | 说明 |
|------|------|------|
| Node.js | `C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe` | 隔离运行环境 |
| PM2 | `C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd` | Node 进程守护 |
| PostgreSQL | `C:\Users\28737\pgsql` | 便携版数据库 |
| 后端入口 | `C:\Users\28737\Desktop\新建文件夹\server\server.js` | Express API + 采集调度 |
| PM2 配置 | `C:\Users\28737\Desktop\新建文件夹\server\ecosystem.config.js` | 进程守护配置 |

## 二、快速启动（手动，推荐用 PowerShell）

由于项目路径包含中文，批处理文件在某些环境下会出现编码问题，建议直接使用 PowerShell 脚本。

以管理员身份打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\28737\Desktop\新建文件夹\scripts\start-orps.ps1"
```

该脚本会：
1. 检查并启动 PostgreSQL；
2. 用 PM2 启动 `server.js`；
3. 保存进程列表，供开机恢复使用。

启动后访问：http://localhost:3000/index.html

## 三、设置开机自启（只需执行一次）

以管理员身份打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\28737\Desktop\新建文件夹\scripts\install-scheduled-tasks.ps1"
```

执行后会创建两个计划任务：

- `\ORPS\PostgresBoot`：系统启动时启动 PostgreSQL。
- `\ORPS\ServerBoot`：用户登录后 30 秒，静默启动 Node/PM2 后端与采集引擎。

之后每次开机，系统都会自动完成启动流程，无需人工干预。

## 四、常用管理命令

### 查看 PM2 进程
```powershell
C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd status
C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd logs orps-server
```

### 重启后端
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\28737\Desktop\新建文件夹\scripts\restart-orps.ps1"
```

### 停止后端（不停止 PostgreSQL）
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\28737\Desktop\新建文件夹\scripts\stop-orps.ps1"
```

### 停止 PostgreSQL
```powershell
C:\Users\28737\pgsql\bin\pg_ctl.exe stop -D C:\Users\28737\pgsql\data
```

## 五、采集机制说明

- `server.js` 启动后会自动执行 `initApp()`：初始化数据库 → 迁移采集库 → 填充系统数据 → 同步 DataHub → 延迟 3 秒启动采集引擎 `DATASOURCES.startEngine()`。
- 采集引擎每 5 秒触发一次调度，按 120 秒周期轮询数据源底座，自动抓取、翻译、过闸、入库、分发。
- 所有入库数据均为真实抓取，无模拟数据；闸门保证无关涉华/非海外利益安全数据不进入预警中心。

## 六、故障排查

| 现象 | 排查 |
|------|------|
| 页面打不开 | 浏览器访问 `http://localhost:3000/api/health`，看是否返回 `database: connected` |
| 后端未运行 | 执行 `pm2 status` 查看 `orps-server` 状态；若不存在，执行 `start-orps.ps1` |
| PostgreSQL 未启动 | 执行 `start-postgres.bat`，或查看 `C:\Users\28737\pgsql\pg.log` |
| 采集指标不动 | 确认后端正常运行；过严闸门会过滤非涉华/弱相关外文新闻，属正常现象 |
| 修改代码后未生效 | PM2 默认不 watch 文件，执行 `restart-orps.ps1`；前端修改后浏览器按 `Ctrl+Shift+R` 硬刷新 |

## 七、安全提示

- 生产部署前，请修改 `server\.env` 中的 `DB_PASS` 和 `JWT_SECRET`。
- 不要把 `.env` 文件提交到版本控制。
- PM2 日志位于 `server\logs\`，定期清理避免磁盘占满。
