/* ===== 社交媒体情报采集通道（2026-08-13 移植自 osint-alerter）=====
 * 信源：Telegram 公开频道（t.me/s 免登录预览页）+ Reddit 官方 RSS。
 * 直连不通，走本机代理（默认 127.0.0.1:7897，可用环境变量 SOCIAL_PROXY 覆盖，设 'direct' 走直连）。
 * 已并入主采集循环（GLOBALMEDIA 每 60s 一轮），模块内部按 5 分钟节流：
 *   - TG 每轮轮换 12 个频道（prio=1 涉华/高危频道每轮必抓）
 *   - Reddit 每轮 3 个版块
 * 全部套用系统既有规则：24h 时效、软性垃圾闸、安全事件直放/涉华闸门、
 * 标题去重、俄乌配额（下游 GLOBALMEDIA 入库循环统一执行）。
 * 信源分级：社媒默认 D 级（未证实），知名媒体官方频道按其媒体定级。
 */
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const scrapers = require('./scrapers');
const globalmedia = require('./globalmedia');

const PROXY = process.env.SOCIAL_PROXY === undefined ? 'http://127.0.0.1:7897' : process.env.SOCIAL_PROXY;
const _agent = (PROXY && PROXY !== 'direct') ? new HttpsProxyAgent(PROXY) : undefined;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const POLL_MS = 5 * 60 * 1000;       /* 5 分钟节流（TG 预览页只留最近约20条，轮询不宜超10分钟） */
const TG_ROTATE = 12;                /* 每轮 TG 频道数（prio=1 必抓 + prio=2 轮换） */
const FRESH_MS = 24 * 60 * 60 * 1000;

/* ===== TG 频道清单（移植自 osint-alerter config.yaml）===== */
const TG_CHANNELS = [
  { ch: 'thebalochistanpost', cn: '巴基斯坦', iso: 'PK', prio: 1, note: '俾路支（针对中方人员/项目袭击）' },
  { ch: 'MenchOsint', cn: '国际', iso: 'UN', prio: 1, note: '萨赫勒/西非方向' },
  { ch: 'KashmirIntel', cn: '印度', iso: 'IN', prio: 1, note: '克什米尔方向' },
  { ch: 'qudsnen', cn: '巴勒斯坦', iso: 'PS', prio: 1, note: 'Quds News（英文）' },
  { ch: 'alarabiya', cn: '沙特', iso: 'SA', prio: 1, note: '阿拉比亚电视台', media: 'Al Arabiya' },
  { ch: 'AlHadath', cn: '沙特', iso: 'SA', prio: 1, note: '哈达斯新闻', media: 'Al Hadath' },
  { ch: 'african_stream', cn: '国际', iso: 'UN', prio: 1, note: 'African Stream' },
  { ch: 'voachinese', cn: '美国', iso: 'US', prio: 1, note: '美国之音中文', media: 'VOA' },
  { ch: 'SCMPNews', cn: '中国香港', iso: 'HK', prio: 1, note: '南华早报', media: 'SCMP' },
  { ch: 'XHNews', cn: '中国', iso: 'CN', prio: 1, note: '新华社', media: '新华社' },
  { ch: 'liveuamap', cn: '国际', iso: 'UN', prio: 2, note: 'Liveuamap 冲突地图' },
  { ch: 'warmonitors', cn: '国际', iso: 'UN', prio: 2, note: 'Global News Monitor' },
  { ch: 'clashreport', cn: '国际', iso: 'UN', prio: 2, note: 'Clash Report' },
  { ch: 'osintdefender', cn: '国际', iso: 'UN', prio: 2, note: 'OSINTdefender' },
  { ch: 'osinttechnical', cn: '国际', iso: 'UN', prio: 2, note: 'OSINTtechnical' },
  { ch: 'OsintUpdates', cn: '国际', iso: 'UN', prio: 2, note: 'Osint Updates' },
  { ch: 'AuroraIntel', cn: '国际', iso: 'UN', prio: 2, note: 'Aurora Intel' },
  { ch: 'CIG_telegram', cn: '国际', iso: 'UN', prio: 2, note: 'Counter Intelligence Global' },
  { ch: 'ddgeopolitics', cn: '国际', iso: 'UN', prio: 2, note: 'DD Geopolitics' },
  { ch: 'bellingcat', cn: '国际', iso: 'UN', prio: 2, note: 'Bellingcat', media: 'Bellingcat' },
  { ch: 'understandingwar', cn: '国际', iso: 'UN', prio: 2, note: 'ISW 战争研究所', media: 'ISW' },
  { ch: 'conflictlive', cn: '国际', iso: 'UN', prio: 2, note: 'CONFLICT.LIVE（俄语）' },
  { ch: 'WarNewsPL1', cn: '国际', iso: 'UN', prio: 2, note: 'WarNewsPL' },
  { ch: 'rybar', cn: '俄罗斯', iso: 'RU', prio: 2, note: 'Rybar（俄方视角）' },
  { ch: 'wargonzo', cn: '俄罗斯', iso: 'RU', prio: 2, note: 'WarGonzo' },
  { ch: 'two_majors', cn: '俄罗斯', iso: 'RU', prio: 2, note: 'Two Majors' },
  { ch: 'tass_agency', cn: '俄罗斯', iso: 'RU', prio: 2, note: '塔斯社', media: 'TASS' },
  { ch: 'operativnoZSU', cn: '乌克兰', iso: 'UA', prio: 2, note: '乌军作战频道' },
  { ch: 'DeepStateUA', cn: '乌克兰', iso: 'UA', prio: 2, note: 'DeepState' },
  { ch: 'uniannet', cn: '乌克兰', iso: 'UA', prio: 2, note: 'UNIAN' },
  { ch: 'thecradlemedia', cn: '国际', iso: 'UN', prio: 2, note: 'The Cradle（中东）' },
  { ch: 'france24', cn: '法国', iso: 'FR', prio: 2, note: 'FRANCE 24', media: 'France 24' },
  { ch: 'AJEnglish', cn: '卡塔尔', iso: 'QA', prio: 2, note: 'Al Jazeera English', media: 'Al Jazeera' },
  { ch: 'wartranslated', cn: '国际', iso: 'UN', prio: 2, note: 'War Translated' },
  { ch: 'MilitarySummary', cn: '国际', iso: 'UN', prio: 2, note: 'Military Summary' },
  { ch: 'CovertShores', cn: '国际', iso: 'UN', prio: 2, note: 'H I Sutton（海军装备）' },
  { ch: 'Zoka200', cn: '俄罗斯', iso: 'RU', prio: 2, note: 'ZOKA（俄方博主）' },
  { ch: 'initiumnews', cn: '中国香港', iso: 'HK', prio: 2, note: '端传媒' },
  { ch: 'chinadigitaltimes', cn: '美国', iso: 'US', prio: 2, note: '中国数字时代' },
  { ch: 'NHKWORLD', cn: '日本', iso: 'JP', prio: 2, note: 'NHK 国际', media: 'NHK' },
  { ch: 'ElPais', cn: '西班牙', iso: 'ES', prio: 2, note: '西班牙国家报（拉美覆盖）', media: 'El Pais' },
  { ch: 'AKIpress', cn: '吉尔吉斯斯坦', iso: 'KG', prio: 2, note: 'AKIpress（中亚）' },
  { ch: 'cve_notify', cn: '国际', iso: 'UN', prio: 2, note: 'CVE 通报' },
  { ch: 'vulnerability_lab', cn: '国际', iso: 'UN', prio: 2, note: '漏洞实验室' }
];

const REDDIT_SUBS = ['worldnews', 'geopolitics', 'netsec'];

/* ===== 基础抓取 ===== */
function _get(url, timeout) {
  return new Promise(resolve => {
    const req = https.get(url, { timeout: timeout || 15000, headers: UA, agent: _agent }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(''); }
      let d = '';
      res.on('data', c => { d += c; if (d.length > 800000) req.destroy(); });
      res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}
function _stripTags(s) {
  return _decodeEntities(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/* ===== Telegram t.me/s 解析 ===== */
async function fetchTelegramChannel(ch) {
  const html = await _get('https://t.me/s/' + ch, 15000);
  if (!html) return [];
  const out = [];
  const blocks = html.split('tgme_widget_message_wrap');
  const now = Date.now();
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const pm = b.match(/data-post="([^"]+)"/);
    const tm = b.match(/datetime="([^"]+)"/);
    const tx = b.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!pm || !tx) continue;
    const ts = tm ? tm[1] : '';
    const t = ts ? new Date(ts).getTime() : 0;
    /* 24h 时效铁律：只保留 24 小时内消息 */
    if (t && now - t > FRESH_MS) continue;
    const text = _stripTags(tx[1]);
    if (!text || text.length < 12) continue;
    out.push({
      id: 'tg:' + pm[1],
      text: text.slice(0, 600),
      link: 'https://t.me/' + pm[1],
      publish_time: ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : ''
    });
  }
  return out;
}

/* ===== Reddit 官方 RSS（Atom）解析 ===== */
async function fetchRedditSub(sub) {
  const xml = await _get('https://www.reddit.com/r/' + sub + '/new/.rss', 15000);
  if (!xml) return [];
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  const now = Date.now();
  for (const e of entries) {
    const tm = e.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const um = e.match(/<updated>([^<]+)<\/updated>/);
    const lm = e.match(/<link[^>]*href="([^"]+)"/);
    const im = e.match(/<id>([^<]+)<\/id>/);
    if (!tm) continue;
    const ts = um ? um[1] : '';
    const t = ts ? new Date(ts).getTime() : 0;
    if (t && now - t > FRESH_MS) continue;
    const text = _stripTags(tm[1]);
    if (!text || text.length < 12) continue;
    out.push({
      id: 'reddit:' + (im ? im[1] : (lm ? lm[1] : text.slice(0, 40))),
      text: text.slice(0, 600),
      link: lm ? lm[1] : '',
      publish_time: ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : ''
    });
  }
  return out;
}

/* ===== 闸门：安全事件直放 / 涉华过双闸 / 软性垃圾拦截 ===== */
function _gateSocial(text) {
  const txt = String(text || '');
  if (!txt) return false;
  if (globalmedia._isSoftJunk(txt)) return false;
  /* 国内新闻硬拦截（2026-08-13 用户指令：国内数据不入系统） */
  if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(txt)) return false;
  if (globalmedia._isSecurityEvent(txt)) return true;
  if (!globalmedia.gateRelevant(txt)) return false;
  const gate = scrapers.chinaOverseasGate(txt);
  return !!gate.pass;
}

/* ===== 主入口：每轮由 GLOBALMEDIA 调用，内部 5 分钟节流 ===== */
let _lastRun = 0;
let _tgCursor = 0;

async function scrapeSocialMedia(opts) {
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && now - _lastRun < POLL_MS) return { count: 0, items: [], throttled: true };
  _lastRun = now;

  const out = [];
  const seen = new Set();

  /* TG：prio=1 每轮必抓，prio=2 轮换补足 TG_ROTATE 个 */
  const must = TG_CHANNELS.filter(c => c.prio === 1);
  const rot = TG_CHANNELS.filter(c => c.prio === 2);
  const rotN = Math.max(0, (opts.tgPerRound || TG_ROTATE) - must.length);
  const picked = must.slice();
  for (let i = 0; i < rotN && rot.length; i++) picked.push(rot[(_tgCursor + i) % rot.length]);
  _tgCursor = rot.length ? (_tgCursor + rotN) % rot.length : 0;

  /* 并发 3 抓 TG */
  for (let i = 0; i < picked.length; i += 3) {
    const batch = picked.slice(i, i + 3);
    const results = await Promise.all(batch.map(c =>
      Promise.race([
        fetchTelegramChannel(c.ch),
        new Promise(r => setTimeout(() => r([]), 18000))
      ]).catch(() => []).then(msgs => ({ c, msgs }))
    ));
    for (const { c, msgs } of results) {
      for (const m of msgs) {
        if (seen.has(m.id)) continue;
        if (!_gateSocial(m.text)) continue;
        seen.add(m.id);
        const srcName = c.media || ('TG @' + c.ch);
        const isChina = /中国|Chinese|China|Beijing|中资|中企|华人|一带一路|Taiwan|Hong Kong/i.test(m.text);
        out.push({
          title: m.text.slice(0, 120),
          content: m.text,
          url: m.link,
          country_cn: c.cn, country_iso: c.iso,
          dims: isChina ? ['A', 'E', 'F'] : ['E', 'F'],
          source: srcName + '（TG）',
          credibility: c.media ? globalmedia._sourceCredibility(c.media) : 'D',
          category: '社交媒体情报', data_type: 'osint_intel',
          social_platform: 'telegram',
          interestLinked: true, chinaRelated: isChina,
          language: /[一-龥]/.test(m.text) ? 'zh' : 'en',
          publish_time: m.publish_time,
          _real: true, _fromSource: 'TG:' + c.ch,
          _sourceType: 'social_media'
        });
      }
    }
  }

  /* Reddit：3 个版块全抓 */
  const rResults = await Promise.all(REDDIT_SUBS.map(sub =>
    Promise.race([
      fetchRedditSub(sub),
      new Promise(r => setTimeout(() => r([]), 18000))
    ]).catch(() => []).then(msgs => ({ sub, msgs }))
  ));
  for (const { sub, msgs } of rResults) {
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      if (!_gateSocial(m.text)) continue;
      seen.add(m.id);
      const isChina = /中国|Chinese|China|Beijing|中资|中企|华人|一带一路|Taiwan|Hong Kong/i.test(m.text);
      out.push({
        title: m.text.slice(0, 120),
        content: m.text,
        url: m.link,
        country_cn: '国际', country_iso: 'UN',
        dims: isChina ? ['A', 'E', 'F'] : ['E', 'F'],
        source: 'Reddit r/' + sub,
        credibility: 'D',
        category: '社交媒体情报', data_type: 'osint_intel',
        social_platform: 'reddit',
        interestLinked: true, chinaRelated: isChina,
        language: 'en',
        publish_time: m.publish_time,
        _real: true, _fromSource: 'REDDIT:' + sub,
        _sourceType: 'social_media'
      });
    }
  }

  return { count: out.length, items: out };
}

module.exports = { scrapeSocialMedia, fetchTelegramChannel, fetchRedditSub, TG_CHANNELS, REDDIT_SUBS };
