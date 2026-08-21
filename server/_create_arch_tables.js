const {query} = require('./db');
(async()=>{
  try{
    /* 创建结构化情报库 */
    await query(`CREATE TABLE IF NOT EXISTS intel_structured (
      id SERIAL PRIMARY KEY,
      raw_id INTEGER,
      data_type VARCHAR(50),
      title TEXT,
      title_zh TEXT,
      content TEXT,
      content_zh TEXT,
      country VARCHAR(100),
      country_iso VARCHAR(10),
      location VARCHAR(200),
      lat DECIMAL(10,6),
      lon DECIMAL(10,6),
      event_date TIMESTAMP,
      severity VARCHAR(20),
      risk_score INTEGER,
      entities JSONB,
      keywords TEXT[],
      china_related BOOLEAN DEFAULT false,
      china_negative BOOLEAN DEFAULT false,
      sentiment VARCHAR(20),
      source VARCHAR(200),
      source_url TEXT,
      data_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('intel_structured created');

    /* 创建预警规则表 */
    await query(`CREATE TABLE IF NOT EXISTS alert_rules (
      id SERIAL PRIMARY KEY,
      rule_id VARCHAR(50) UNIQUE,
      name VARCHAR(200),
      description TEXT,
      category VARCHAR(50),
      threshold_value INTEGER,
      threshold_unit VARCHAR(20),
      level VARCHAR(20),
      enabled BOOLEAN DEFAULT true,
      trigger_count INTEGER DEFAULT 0,
      last_triggered TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('alert_rules created');

    /* 创建预警记录表 */
    await query(`CREATE TABLE IF NOT EXISTS alert_records (
      id SERIAL PRIMARY KEY,
      alert_no VARCHAR(100) UNIQUE,
      rule_id VARCHAR(50),
      intel_id INTEGER,
      title TEXT,
      country VARCHAR(100),
      level VARCHAR(20),
      status VARCHAR(20) DEFAULT 'active',
      triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMP,
      resolved_at TIMESTAMP,
      assigned_to VARCHAR(100),
      notes TEXT
    )`);
    console.log('alert_records created');

    /* 创建周期统计表 */
    await query(`CREATE TABLE IF NOT EXISTS intel_daily_stats (
      id SERIAL PRIMARY KEY,
      stat_date DATE,
      data_type VARCHAR(50),
      total_count INTEGER,
      china_count INTEGER,
      china_negative_count INTEGER,
      risk_score_avg DECIMAL(5,2),
      top_countries JSONB,
      top_keywords JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(stat_date, data_type)
    )`);
    console.log('intel_daily_stats created');

    console.log('All architecture tables created successfully');
  }catch(e){console.error('Error:',e.message);}
})();
