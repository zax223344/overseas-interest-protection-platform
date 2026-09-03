-- 2026-09-04 P1-1/2/3 结构化归一触发器（采集矩阵深度体检修复）
-- ================================================================
-- 背景：大模型研判依赖精准结构化分类。体检发现三类结构化污染：
--   P1-1 category 无受控词表（49% 空、25+ 自由写法、视图名混入）
--   P1-2 country 三种语义混用（事件国/媒体总部国/人员国籍国，LLM 无法区分）
--   P1-3 event_date 四种格式混杂（纯日期/ISO/RFC2822 邮件头/空串）
-- 方案：BEFORE INSERT OR UPDATE 行级触发器 = 唯一咽喉点，覆盖全部 13 个
--   INSERT 路径（含 terror 直插等绕过 _preInsertGate 的通道）与未来新增通道。
-- 规则：
--   ① category 以 data_type 14 类受控枚举为唯一事实源统一重写；
--     原自由文本首写保留在 category_raw（溯源，只存一次）
--   ② country_basis 按通道语义标注：hq=信源/媒体国，event=事件国；
--     采集侧显式标注优先，触发器只补空值
--   ③ event_date 统一截取 yyyy-mm-dd（时间精度保留在 data_json.publish_time）

CREATE OR REPLACE FUNCTION orps_intel_normalize() RETURNS trigger AS $$
DECLARE
  dj jsonb;
  cat_cn text;
  old_cat text;
  basis text;
  st text;
  ed text;
  dd text;
BEGIN
  -- ③ event_date 归一（yyyy-mm-dd）
  ed := COALESCE(NEW.event_date, '');
  IF ed <> '' AND ed !~ '^\d{4}-\d{2}-\d{2}$' THEN
    dd := substring(ed from '\d{4}-\d{2}-\d{2}');
    IF dd IS NULL AND ed ~ '^\d{8}T\d{6}Z$' THEN
      -- GDELT seendate 原始格式（20260903T044500Z）
      dd := substring(ed from 1 for 4) || '-' || substring(ed from 5 for 2) || '-' || substring(ed from 7 for 2);
    END IF;
    IF dd IS NULL AND ed ~ '^[A-Za-z]{3}, ' THEN
      BEGIN
        dd := to_char(to_timestamp(ed, 'Dy, DD Mon YYYY HH24:MI:SS'), 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN dd := NULL;
      END;
    END IF;
    IF dd IS NOT NULL THEN NEW.event_date := dd; END IF;
  END IF;

  dj := COALESCE(NEW.data_json, '{}'::jsonb);

  -- ② country_basis 兜底（采集侧显式标注优先，绝不覆盖）
  IF dj->>'country_basis' IS NULL THEN
    st := COALESCE(dj->>'_sourceType', '');
    basis := CASE
      WHEN st IN ('sources_pack','media','gdelt_theme','gdelt','china_focus','cn_media',
                  'think_tank','wm_feed','terror_attack','kidnap_case','org_watch','bri_focus',
                  'china_negative','satellite','cyber_feed','election_watch','social_media') THEN 'hq'
      WHEN st IN ('consular_watch','cnsec_watch','channel_watch','compliance_watch','project_watch',
                  'threatroom','query','gap_scheduler','socmint_watch','special_matrix','wechat_oa',
                  'wechat_lead','frontend_post','core_threat_watch','core_threat_sentinel',
                  'region_balance','category_balance') THEN 'event'
      ELSE NULL
    END;
    IF basis IS NOT NULL THEN dj := jsonb_set(dj, '{country_basis}', to_jsonb(basis)); END IF;
  END IF;

  -- ① category 受控词表（data_type → 中文类别，唯一事实源）
  cat_cn := CASE NEW.data_type
    WHEN 'geopolitical_intel' THEN '地缘政治情报'
    WHEN 'terror_events'      THEN '恐怖袭击与武装袭击'
    WHEN 'military_conflicts' THEN '军事冲突'
    WHEN 'infrastructure'     THEN '基础设施与关键矿产'
    WHEN 'social_unrest'      THEN '社会动荡'
    WHEN 'political_events'   THEN '政治事件'
    WHEN 'sanctions_data'     THEN '制裁与合规'
    WHEN 'osint_intel'        THEN '开源情报'
    WHEN 'natural_disasters'  THEN '自然灾害'
    WHEN 'economic_risk'      THEN '经济风险'
    WHEN 'public_health'      THEN '公共卫生'
    WHEN 'legal_compliance'   THEN '法律合规'
    WHEN 'cyber_security'     THEN '网络安全'
    WHEN 'security_events'    THEN '治安事件'
    ELSE NULL
  END;
  IF cat_cn IS NOT NULL THEN
    old_cat := dj->>'category';
    IF old_cat IS NOT NULL AND old_cat <> cat_cn AND dj->>'category_raw' IS NULL THEN
      dj := jsonb_set(dj, '{category_raw}', to_jsonb(old_cat));
    END IF;
    IF COALESCE(old_cat, '') <> cat_cn THEN
      dj := jsonb_set(dj, '{category}', to_jsonb(cat_cn));
    END IF;
  END IF;

  NEW.data_json := dj;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intel_normalize ON intel_data;
CREATE TRIGGER trg_intel_normalize
  BEFORE INSERT OR UPDATE ON intel_data
  FOR EACH ROW EXECUTE FUNCTION orps_intel_normalize();
