-- ============================================================
-- 海外利益保护情报预警平台 - PostgreSQL 数据库初始化脚本
-- ============================================================

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 用户表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(64) UNIQUE NOT NULL,
    password    VARCHAR(256) NOT NULL,          -- bcrypt 哈希
    role        VARCHAR(16) NOT NULL DEFAULT 'user',   -- admin / user
    status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- approved / pending / rejected
    reg_time    TIMESTAMPTZ DEFAULT NOW(),
    expire_time TIMESTAMPTZ,
    is_default  BOOLEAN DEFAULT FALSE,
    trial       BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 默认管理员 (密码 admin123 的 bcrypt 哈希)
INSERT INTO users (username, password, role, status, is_default, is_active)
VALUES ('admin', '$2b$10$8K1p/a0dRTllRX2gP1NjwOJmQb3VZqR1lJZ5Jq3yNq5mLZ8V2qK.G', 'admin', 'approved', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 2. 情报数据表 (DBCenter 11类情报 + 日志)
-- ============================================================
CREATE TABLE IF NOT EXISTS intel_data (
    id            BIGSERIAL PRIMARY KEY,
    data_type     VARCHAR(32) NOT NULL,   -- terror_events / security_events / military_conflicts / political_events / natural_disasters / public_health / sanctions_data / social_unrest / infrastructure / geopolitical_intel / osint_intel / collect_logs
    title         TEXT,
    country       VARCHAR(128),
    location      VARCHAR(256),
    event_date    VARCHAR(32),
    severity      VARCHAR(16),
    description   TEXT,
    source        VARCHAR(256),
    data_json     JSONB NOT NULL DEFAULT '{}',  -- 完整数据对象
    audit_status  VARCHAR(16) DEFAULT 'pending', -- pending / approved / rejected
    audit_time    VARCHAR(64) DEFAULT '',
    collect_time  TIMESTAMPTZ DEFAULT NOW(),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intel_type ON intel_data(data_type);
CREATE INDEX IF NOT EXISTS idx_intel_audit ON intel_data(audit_status);
CREATE INDEX IF NOT EXISTS idx_intel_country ON intel_data(country);

-- ============================================================
-- 3. DataHub 数据集表 (countries, enterprises, alerts, events, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS datahub_store (
    id            BIGSERIAL PRIMARY KEY,
    collection    VARCHAR(64) NOT NULL,   -- countries / enterprises / alerts / events / warning_rules / chokepoints / corridors / predictions / terror_events / china_security / playbooks / _pending_reviews
    data_json     JSONB NOT NULL DEFAULT '[]',  -- 整个数组作为一个 JSON 存储
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(collection)
);

-- 初始化空数组
INSERT INTO datahub_store (collection, data_json) VALUES
    ('countries', '[]'), ('enterprises', '[]'), ('alerts', '[]'),
    ('events', '[]'), ('warning_rules', '[]'), ('chokepoints', '[]'),
    ('corridors', '[]'), ('predictions', '[]'), ('terror_events', '[]'),
    ('china_security', '[]'), ('playbooks', '[]'), ('_pending_reviews', '[]')
ON CONFLICT (collection) DO NOTHING;

-- ============================================================
-- 4. AI 情报分析报告表
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_reports (
    id              BIGSERIAL PRIMARY KEY,
    report_id       BIGINT,                 -- 前端生成的 ID
    title           VARCHAR(256) NOT NULL,
    mode            VARCHAR(32) NOT NULL,   -- elements / strategic / tactical / risk
    country         VARCHAR(128),
    level           VARCHAR(16),
    report_type     VARCHAR(64),
    materials       TEXT,
    threat_analysis TEXT,
    impact_analysis TEXT,
    advice          TEXT,
    content_json    JSONB DEFAULT '{}',     -- 完整报告对象（兼容前端）
    author          VARCHAR(64),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_mode ON ai_reports(mode);
CREATE INDEX IF NOT EXISTS idx_reports_country ON ai_reports(country);
CREATE INDEX IF NOT EXISTS idx_reports_created ON ai_reports(created_at DESC);

-- ============================================================
-- 5. 威胁组织表
-- ============================================================
CREATE TABLE IF NOT EXISTS threat_orgs (
    id          BIGSERIAL PRIMARY KEY,
    org_id      VARCHAR(64) UNIQUE,
    name        VARCHAR(256) NOT NULL,
    type        VARCHAR(64),
    country     VARCHAR(128),
    level       VARCHAR(16),
    "desc"      TEXT,
    data_json   JSONB DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. 企业项目表
-- ============================================================
CREATE TABLE IF NOT EXISTS enterprise_projects (
    id          BIGSERIAL PRIMARY KEY,
    enterprise  VARCHAR(256),
    project     VARCHAR(256),
    country     VARCHAR(128),
    location    VARCHAR(256),
    status      VARCHAR(32),
    data_json   JSONB DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_country ON enterprise_projects(country);

-- ============================================================
-- 7. 风险融合数据表
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_fusion (
    id          BIGSERIAL PRIMARY KEY,
    fusion_id   VARCHAR(64) UNIQUE,
    title       VARCHAR(256),
    country     VARCHAR(128),
    level       VARCHAR(16),
    sources     TEXT,
    data_json   JSONB DEFAULT '{}',
    fusion_time TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. 自动预警规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_alerts (
    id          BIGSERIAL PRIMARY KEY,
    alert_id    VARCHAR(64) UNIQUE,
    title       VARCHAR(256),
    country     VARCHAR(128),
    level       VARCHAR(16),
    type        VARCHAR(64),
    "desc"      TEXT,
    status      VARCHAR(16) DEFAULT 'active',
    data_json   JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_alerts_status ON auto_alerts(status);

-- ============================================================
-- 9. 审计日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    action      VARCHAR(64) NOT NULL,
    operator    VARCHAR(64),
    target      VARCHAR(256),
    detail      TEXT,
    data_json   JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);

-- ============================================================
-- 10. 威胁评估表
-- ============================================================
CREATE TABLE IF NOT EXISTS threat_assessments (
    id          BIGSERIAL PRIMARY KEY,
    assess_type VARCHAR(32) UNIQUE NOT NULL,   -- assess / custom
    data_json   JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. 用户设置表 (面板位置、监控联动等)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
    setting_key VARCHAR(128) NOT NULL,
    setting_val JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, setting_key)
);

-- ============================================================
-- 12. 采集数据表 (orps_collected_*)
-- ============================================================
CREATE TABLE IF NOT EXISTS collected_data (
    id              BIGSERIAL PRIMARY KEY,
    source_type     VARCHAR(64) NOT NULL,   -- 采集来源类型
    title           TEXT,
    url             TEXT,
    content         TEXT,
    country         VARCHAR(128),
    data_json       JSONB DEFAULT '{}',
    collect_time    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collected_source ON collected_data(source_type);
CREATE INDEX IF NOT EXISTS idx_collected_time ON collected_data(collect_time DESC);

-- ============================================================
-- 更新时间触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有有 updated_at 字段的表创建触发器
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables 
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
             AND EXISTS (
                 SELECT 1 FROM information_schema.columns 
                 WHERE table_name = t AND column_name = 'updated_at'
             )
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_%s_updated ON %I;
            CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        ', t, t, t, t);
    END LOOP;
END;
$$;

-- ============================================================
-- 完成
-- ============================================================
