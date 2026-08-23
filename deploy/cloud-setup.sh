#!/usr/bin/env bash
# ============================================================================
# ORPS 海外利益保护情报预警平台 — 云服务器一键初始化
# 适用：Ubuntu 22.04 / 24.04（腾讯云轻量海外机房官方镜像），root 身份执行
# 用法：bash cloud-setup.sh "<git仓库URL(可含PAT)>"
# 可选环境变量：ORPS_DB_PASS（数据库密码，默认自动生成并打印）
# 幂等：重复执行安全（已装组件自动跳过）
# ============================================================================
set -euo pipefail

REPO_URL="${1:?用法: bash cloud-setup.sh <git仓库URL>}"
APP_DIR=/opt/orps
DB_NAME=orps_db
DB_USER=orps_user
DB_PASS="${ORPS_DB_PASS:-$(openssl rand -hex 12)}"
LOG_DIR=$APP_DIR/server/logs

echo "==> [1/7] 系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git gnupg build-essential ufw

echo "==> [2/7] Node.js 22"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [3/7] PostgreSQL 16"
if ! command -v psql >/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now postgresql
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres createdb -O $DB_USER $DB_NAME

echo "==> [4/7] 拉取代码"
if [ -d "$APP_DIR/.git" ]; then
  git -C $APP_DIR pull --ff-only || true
else
  git clone "$REPO_URL" $APP_DIR
fi
cd $APP_DIR/server
npm install --omit=dev

echo "==> [5/7] 写入配置（海外机房：境外源直连，OVERSEAS_PROXY=direct）"
mkdir -p $LOG_DIR
cat > .env <<EOF
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
JWT_SECRET=$(openssl rand -hex 24)
JWT_EXPIRES_IN=24h
PORT=3000
NODE_ENV=production
CORS_ORIGIN=*
OVERSEAS_PROXY=direct
EOF
chmod 600 .env

echo "==> [6/7] 初始化数据库表结构"
node scripts/init-db.js || true
# 若存在从旧机迁移来的数据包则恢复
if [ -f /root/orps-dump.sql ]; then
  echo "发现 /root/orps-dump.sql，执行数据恢复..."
  sudo -u postgres psql $DB_NAME < /root/orps-dump.sql
fi

echo "==> [7/7] PM2 守护 + 开机自启 + 防火墙"
npm install -g pm2
pm2 delete orps-server 2>/dev/null || true
pm2 start server.js --name orps-server \
  --output $LOG_DIR/pm2-out.log --error $LOG_DIR/pm2-err.log
pm2 startup systemd -u root --hp /root || true
pm2 save
ufw allow 3000/tcp || true
ufw --force enable || true

echo ""
echo "============================================================"
echo " 部署完成！面板地址: http://$(curl -s ifconfig.me || echo '<服务器IP>'):3000"
echo " 数据库密码: $DB_PASS （已写入 $APP_DIR/server/.env）"
echo " 日志: tail -f $LOG_DIR/pm2-out.log"
echo " 注意：还需在腾讯云控制台「防火墙」里放行 3000 端口！"
echo "============================================================"
