# 海外利益保护情报预警平台 — 结构化数据存储与周期研判架构设计

## 一、设计目标

参考 Palantir Gotham、Recorded Future、Babel Street、Dataminr 等国外情报分析平台，构建覆盖"采集 → 存储 → 索引 → 分析 → 预警 → 可视化"全链路的数据架构，实现：

1. **按类别结构化存储**：每日采集数据按 12 类情报分类入库，支持按类别、时间、国家、风险等级多维检索。
2. **周期研判支持**：支持按日/周/月/季/自定义周期进行数据聚合、趋势分析、关联研判。
3. **智能预警引擎**：基于历史数据建立风险基线，实现阈值预警、趋势预警、异常预警。
4. **全生命周期管理**：从数据采集到归档、销毁的全流程管控。

## 二、总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        可视化层 (Visualization)                  │
│  态势大屏 │ 专题分析 │ 周期报告 │ 预警看板 │ 风险矩阵 │ 地图态势 │
├─────────────────────────────────────────────────────────────────┤
│                        预警引擎 (Alerting Engine)                │
│  规则引擎 │ 阈值预警 │ 趋势预警 │ 异常检测 │ 风险评分 │ 预警分发 │
├─────────────────────────────────────────────────────────────────┤
│                        分析研判层 (Analytics)                    │
│  周期统计 │ 趋势分析 │ 关联分析 │ 实体画像 │ 风险预测 │ 报告生成 │
├─────────────────────────────────────────────────────────────────┤
│                        数据索引层 (Indexing)                     │
│  全文检索 │ 多维索引 │ 时间序列索引 │ 实体索引 │ 地理空间索引   │
├─────────────────────────────────────────────────────────────────┤
│                        数据存储层 (Storage)                      │
│  原始数据湖 │ 结构化数据仓库 │ 时间序列分区 │ 归档存储 │ 备份    │
├─────────────────────────────────────────────────────────────────┤
│                        数据采集层 (Ingestion)                    │
│  RSS采集 │ API接入 │ 爬虫抓取 │ 社交监听 │ 手动录入 │ 数据清洗  │
└─────────────────────────────────────────────────────────────────┘
```

## 三、数据分类体系（12 类情报）

| 类别代码 | 类别名称 | 子类示例 | 预警级别 |
|---------|---------|---------|---------|
| POL | 政治事件 | 政变、选举、外交冲突、政策变化 | 黄/橙/红 |
| MIL | 军事冲突 | 战争、武装冲突、军事演习、武器扩散 | 橙/红 |
| ECO | 经济风险 | 制裁、贸易战、汇率波动、债务危机 | 黄/橙 |
| SEC | 安全事件 | 恐怖袭击、绑架、枪击、爆炸 | 橙/红 |
| SOC | 社会动荡 | 抗议、骚乱、罢工、民族冲突 | 黄/橙 |
| INF | 基础设施 | 港口、铁路、能源管道、通信网络 | 黄/橙 |
| PUB | 公共卫生 | 疫情、传染病、食品安全、医疗资源 | 黄/橙 |
| NAT | 自然环境 | 地震、洪水、台风、气候变化 | 黄/橙 |
| GEO | 地缘战略 | 大国博弈、联盟变化、战略通道 | 黄/橙 |
| CYB | 网络安全 | 数据泄露、网络攻击、技术封锁 | 黄/橙 |
| LEG | 法律合规 | 法律变化、合规风险、仲裁诉讼 | 黄 |
| CUL | 社会文化 | 排华情绪、文化冲突、宗教矛盾 | 黄 |

## 四、数据存储设计

### 4.1 原始数据湖（Raw Data Lake）

**表名**：`intel_raw`

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BIGSERIAL | 主键 |
| raw_id | VARCHAR(64) | 原始数据唯一标识（来源+ID哈希） |
| source_type | VARCHAR(32) | 来源类型（RSS/API/爬虫/社交/手动） |
| source_name | VARCHAR(128) | 来源名称 |
| source_url | TEXT | 来源URL |
| title | TEXT | 原始标题 |
| title_zh | TEXT | 中文标题 |
| content | TEXT | 原始内容 |
| content_zh | TEXT | 中文内容 |
| raw_html | TEXT | 原始HTML（可选） |
| language | VARCHAR(16) | 语言 |
| published_at | TIMESTAMP | 发布时间 |
| collected_at | TIMESTAMP | 采集时间 |
| data_json | JSONB | 原始结构化数据 |
| hash | VARCHAR(64) | 内容哈希（去重用） |
| created_at | TIMESTAMP | 入库时间 |

**索引**：
- `idx_intel_raw_hash` (hash) — 去重
- `idx_intel_raw_collected_at` (collected_at) — 时间检索
- `idx_intel_raw_source` (source_type, source_name) — 来源检索

### 4.2 结构化情报库（Structured Intelligence）

**表名**：`intel_structured`

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BIGSERIAL | 主键 |
| raw_id | BIGINT | 关联原始数据 |
| alert_no | VARCHAR(32) | 预警编号 |
| category | VARCHAR(16) | 一级分类（POL/MIL/ECO/SEC等） |
| sub_category | VARCHAR(32) | 二级分类 |
| title | TEXT | 标题 |
| title_zh | TEXT | 中文标题 |
| summary | TEXT | 摘要 |
| content | TEXT | 正文 |
| content_zh | TEXT | 中文正文 |
| country | VARCHAR(64) | 国家/地区 |
| country_iso | VARCHAR(8) | 国家代码 |
| region | VARCHAR(32) | 区域 |
| location | VARCHAR(128) | 具体地点 |
| latitude | DECIMAL(10,7) | 纬度 |
| longitude | DECIMAL(10,7) | 经度 |
| entities | JSONB | 实体列表（企业/人物/组织/项目） |
| keywords | JSONB | 关键词标签 |
| risk_level | VARCHAR(16) | 风险等级（red/orange/yellow/blue） |
| risk_score | DECIMAL(5,2) | 风险分数（0-10） |
| confidence | DECIMAL(5,2) | 置信度（0-100） |
| sentiment | VARCHAR(16) | 情感倾向（positive/negative/neutral） |
| is_china_related | BOOLEAN | 是否涉华 |
| is_overseas_interest | BOOLEAN | 是否海外利益安全 |
| is_negative | BOOLEAN | 是否负面 |
| event_date | DATE | 事件日期 |
| published_at | TIMESTAMP | 发布时间 |
| collected_at | TIMESTAMP | 采集时间 |
| valid_from | TIMESTAMP | 有效开始时间 |
| valid_until | TIMESTAMP | 有效结束时间 |
| status | VARCHAR(16) | 状态（active/resolved/archived） |
| created_at | TIMESTAMP | 入库时间 |
| updated_at | TIMESTAMP | 更新时间 |

**索引**：
- `idx_intel_struct_category_date` (category, event_date) — 类别+日期检索
- `idx_intel_struct_country_date` (country, event_date) — 国家+日期检索
- `idx_intel_struct_risk` (risk_level, risk_score) — 风险检索
- `idx_intel_struct_china` (is_china_related, is_overseas_interest) — 涉华检索
- `idx_intel_struct_event_date` (event_date) — 时间序列分析
- `idx_intel_struct_entities` USING GIN (entities) — 实体检索
- `idx_intel_struct_keywords` USING GIN (keywords) — 关键词检索
- `idx_intel_struct_content` USING GIN (to_tsvector('simple', title || ' ' || content)) — 全文检索

### 4.3 周期统计表（Periodic Analytics）

**表名**：`intel_daily_stats`

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BIGSERIAL | 主键 |
| stat_date | DATE | 统计日期 |
| category | VARCHAR(16) | 类别 |
| country | VARCHAR(64) | 国家 |
| total_count | INT | 总条数 |
| red_count | INT | 红色预警数 |
| orange_count | INT | 橙色预警数 |
| yellow_count | INT | 黄色预警数 |
| blue_count | INT | 蓝色提示数 |
| china_related_count | INT | 涉华条数 |
| negative_count | INT | 负面条数 |
| avg_risk_score | DECIMAL(5,2) | 平均风险分 |
| max_risk_score | DECIMAL(5,2) | 最高风险分 |
| top_entities | JSONB | 热点实体 |
| top_keywords | JSONB | 热点关键词 |
| trend | VARCHAR(16) | 趋势（up/down/stable） |
| created_at | TIMESTAMP | 生成时间 |

**表名**：`intel_weekly_stats` / `intel_monthly_stats` / `intel_quarterly_stats`

结构同 `intel_daily_stats`，增加 `stat_week` / `stat_month` / `stat_quarter` 字段。

### 4.4 预警规则表（Alert Rules）

**表名**：`alert_rules`

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | VARCHAR(32) | 规则ID |
| name | VARCHAR(128) | 规则名称 |
| description | TEXT | 规则描述 |
| rule_type | VARCHAR(32) | 规则类型（threshold/trend/anomaly/pattern） |
| category | VARCHAR(16) | 适用类别 |
| conditions | JSONB | 触发条件 |
| threshold | JSONB | 阈值配置 |
| time_window | VARCHAR(16) | 时间窗口（1h/24h/7d/30d） |
| severity | VARCHAR(16) | 预警级别 |
| enabled | BOOLEAN | 是否启用 |
| notification_channels | JSONB | 通知渠道 |
| created_by | VARCHAR(64) | 创建人 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 4.5 预警记录表（Alert Records）

**表名**：`alert_records`

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BIGSERIAL | 主键 |
| alert_no | VARCHAR(32) | 预警编号 |
| rule_id | VARCHAR(32) | 触发规则 |
| intel_id | BIGINT | 关联情报 |
| title | TEXT | 预警标题 |
| description | TEXT | 预警描述 |
| category | VARCHAR(16) | 类别 |
| country | VARCHAR(64) | 国家 |
| risk_level | VARCHAR(16) | 风险等级 |
| risk_score | DECIMAL(5,2) | 风险分数 |
| trigger_value | JSONB | 触发值 |
| baseline_value | JSONB | 基线值 |
| status | VARCHAR(16) | 状态（active/acknowledged/resolved/ignored） |
| acknowledged_by | VARCHAR(64) | 确认人 |
| acknowledged_at | TIMESTAMP | 确认时间 |
| resolved_by | VARCHAR(64) | 解决人 |
| resolved_at | TIMESTAMP | 解决时间 |
| created_at | TIMESTAMP | 触发时间 |

## 五、数据流转流程

```
┌─────────┐    ┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│  数据源  │ → │  采集清洗    │ → │  intel_raw      │ → │  分类打标    │
└─────────┘    └─────────────┘    └─────────────────┘    └─────────────┘
                                                              │
                                                              ▼
┌─────────┐    ┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│  可视化  │ ← │  预警引擎    │ ← │  intel_structured│ ← │  实体识别    │
└─────────┘    └─────────────┘    └─────────────────┘    └─────────────┘
                     │
                     ▼
              ┌─────────────┐
              │ alert_records│
              └─────────────┘
```

1. **采集清洗**：多源采集 → 去重 → 翻译 → 清洗 → 入 `intel_raw`
2. **分类打标**：NLP/规则引擎 → 分类 → 实体识别 → 风险评分 → 入 `intel_structured`
3. **周期聚合**：定时任务 → 日/周/月/季统计 → 入 `intel_*_stats`
4. **预警触发**：规则引擎 → 匹配 `intel_structured` → 生成 `alert_records`
5. **可视化**：API → 前端展示

## 六、周期研判功能设计

### 6.1 周期统计报表

**日报**：
- 当日各类别情报数量、风险分布、热点国家、热点实体
- 与前一日对比（环比）
- 与近7日平均对比（基线偏离）

**周报**：
- 本周各类别趋势图
- 重点国家风险变化
- 新增/升级/解除预警统计
- 下周风险预测

**月报**：
- 月度风险指数
- 各类别占比分析
- 重大事件回顾
- 下月风险展望

**季报/年报**：
- 长期趋势分析
- 风险热点演变
- 预警准确率统计
- 系统效能评估

### 6.2 专题研判

**国家专题**：
- 某国近30天各类风险趋势
- 中资企业暴露面分析
- 重点项目风险追踪

**类别专题**：
- 全球安全事件热点地图
- 制裁措施影响分析
- 供应链风险传导

**实体专题**：
- 中资企业风险画像
- 重点项目安全评估
- 威胁组织活动分析

### 6.3 预警模型

**阈值预警**：
- 单类别日增量超过阈值
- 单国家风险分数超过阈值
- 单实体提及次数超过阈值

**趋势预警**：
- 连续3日风险上升
- 风险分数突破历史90分位
- 负面情感占比超过60%

**异常预警**：
- 孤立森林/LOF异常检测
- 突发热点事件识别
- 异常传播模式识别

## 七、技术实现方案

### 7.1 数据库优化

**分区表**：
```sql
-- intel_structured 按月分区
CREATE TABLE intel_structured (
  ...
) PARTITION BY RANGE (event_date);

CREATE TABLE intel_structured_2026_08 PARTITION OF intel_structured
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

**物化视图**：
```sql
-- 每日统计物化视图
CREATE MATERIALIZED VIEW mv_intel_daily_stats AS
SELECT
  event_date,
  category,
  country,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE risk_level = 'red') as red_count,
  ...
FROM intel_structured
GROUP BY event_date, category, country;
```

### 7.2 API 设计

**数据查询**：
```
GET /api/v2/intel?category=SEC&country=巴基斯坦&start=2026-08-01&end=2026-08-09
GET /api/v2/intel/stats/daily?date=2026-08-09
GET /api/v2/intel/stats/weekly?week=2026-W32
GET /api/v2/intel/stats/monthly?month=2026-08
```

**周期研判**：
```
GET /api/v2/analysis/trend?category=SEC&period=30d
GET /api/v2/analysis/country/巴基斯坦?period=90d
GET /api/v2/analysis/entity/华为?period=180d
```

**预警管理**：
```
GET /api/v2/alerts?status=active&level=red
POST /api/v2/alerts/{id}/acknowledge
POST /api/v2/alerts/{id}/resolve
GET /api/v2/alerts/rules
POST /api/v2/alerts/rules
```

### 7.3 前端功能

**数据中心增强**：
- 按类别/时间/国家/风险等级多维筛选
- 数据导出（CSV/Excel/PDF）
- 自定义周期报表生成

**研判分析页**：
- 周期趋势图（折线/柱状/热力图）
- 国家风险对比
- 实体关联图谱
- 预警规则配置

**报告生成器**：
- 日报/周报/月报自动生成
- 自定义报告模板
- 一键导出 PDF/Word

## 八、实施路线图

### Phase 1：数据架构升级（1-2 周）
- 创建 `intel_raw` / `intel_structured` / `intel_daily_stats` 表
- 实现数据迁移脚本（现有数据导入新架构）
- 实现分类打标引擎（规则+NLP）

### Phase 2：周期统计实现（1 周）
- 实现日/周/月统计定时任务
- 实现周期统计 API
- 实现前端周期报表

### Phase 3：预警引擎实现（2 周）
- 实现规则引擎
- 实现预警记录管理
- 实现预警通知

### Phase 4：高级分析（2-3 周）
- 实现趋势分析/异常检测
- 实现实体画像/关联分析
- 实现报告生成器

## 九、参考系统对标

| 功能 | Palantir Gotham | Recorded Future | Babel Street | 本系统 |
|-----|----------------|-----------------|-------------|-------|
| 多源采集 | ✅ | ✅ | ✅ | ✅ |
| 结构化存储 | ✅ | ✅ | ✅ | ✅ |
| 全文检索 | ✅ | ✅ | ✅ | ✅ |
| 实体识别 | ✅ | ✅ | ✅ | ✅ |
| 关系图谱 | ✅ | ✅ | ✅ | ✅ |
| 周期统计 | ✅ | ✅ | ✅ | ✅ |
| 趋势预测 | ✅ | ✅ | ✅ | ✅ |
| 实时预警 | ✅ | ✅ | ✅ | ✅ |
| 报告生成 | ✅ | ✅ | ✅ | ✅ |
| 地理空间 | ✅ | ✅ | ✅ | ✅ |
| 机器学习 | ✅ | ✅ | ✅ | 规划中 |
| 定制开发 | ✅ | ✅ | ✅ | ✅ |

## 十、总结

本架构设计参考国际主流情报分析平台，结合中国海外利益安全实际需求，构建了覆盖数据全生命周期的结构化存储与周期研判体系。通过分阶段实施，可在现有系统基础上逐步实现全功能化升级，最终达到国际先进水平。
