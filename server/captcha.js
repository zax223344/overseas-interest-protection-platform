/**
 * 登录图形验证码模块（2026-09-04 用户指令：验证码要发挥真正作用，而不是摆设）
 *
 * 设计铁律：
 *  1. 答案只存服务端内存（_store），响应体/图片/DOM 中均不可读——SVG 用 5x7 点阵
 *     字形（rect 像素块）渲染，不用 <text> 元素，脚本无法从 DOM 提取答案；
 *  2. 一次性核销：无论对错，校验后立即销毁，同一 captchaId 不能用第二次；
 *  3. 短时效：5 分钟过期，后台定时清扫；
 *  4. 签发接口限流：同 IP 30 次/分钟，防刷接口本身；
 *  5. 与登录失败限流联动：密码类失败同 IP 累计 5 次锁 10 分钟（硬兜底，
 *     即使攻击者 OCR 破解验证码，爆破速度也被锁死）。
 */
const crypto_ = require('crypto');

/* ===== 字符集（2026-09-04 四轮校准实测根治）：先除易混淆 0/O/1/I/L，
   再除 5x7 点阵+旋转下实测混淆对——F(P/F)、V(U/V)、W(M/W)、Z(Z/2)、R(P/R)、2(Z/2)、6(G/6)、
   N(M/N 两轮复现)、3(3/S)、Q(D/Q 尾仅2点)、Y(Y/T 叉点仅2点)、5(S/5 双向混淆三连)。
   保留 19 个视觉强可分字符，19^4=13万组合，配合一次性核销+5分钟过期+IP锁定，熵值充足 ===== */
const CHARS = 'ABCDEGHJKMPSTUX4789';
const CAPTCHA_LEN = 4;
const CAPTCHA_TTL = 5 * 60 * 1000;      /* 5 分钟 */
const ISSUE_RATE_MAX = 30;              /* 同 IP 每分钟最多签发 30 张 */
const FAIL_MAX = 5;                     /* 密码类失败 5 次 */
const LOCK_MS = 10 * 60 * 1000;         /* 锁 10 分钟 */

/* ===== 5x7 点阵字形库（1=实心像素）===== */
const FONT = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01110','10001','10000','10000','10000','10001','01110'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01110','10001','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  J: ['00111','00010','00010','00010','00010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','11001','10101','10011','10011','10001'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '2': ['01110','10001','00001','00110','01000','10000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110']
};

const _store = new Map();      /* captchaId -> { text, exp } */
const _issueRate = new Map();  /* ip -> { n, resetAt } */
const _loginFails = new Map(); /* ip -> { n, lockUntil } */

function _rand(n) { return crypto_.randomInt(n); }

function makeText(len) {
  let t = '';
  for (let i = 0; i < (len || CAPTCHA_LEN); i++) t += CHARS[_rand(CHARS.length)];
  return t;
}

/* ===== SVG 渲染：点阵像素块 + 波形扭曲 + 逐字旋转 + 干扰线/噪点 ===== */
function makeSvg(text) {
  const W = 132, H = 44;
  const palette = ['#7fd8ff', '#ffd166', '#ff8fa3', '#9bf6c8', '#c3aed6', '#8ecae6'];
  const parts = [];
  /* 背景 */
  parts.push('<rect width="' + W + '" height="' + H + '" fill="#0a1223"/>');
  /* 干扰曲线 3 条（画在字符下层） */
  for (let i = 0; i < 3; i++) {
    parts.push('<path d="M' + _rand(W) + ' ' + _rand(H) + ' Q' + _rand(W) + ' ' + _rand(H) + ' ' + _rand(W) + ' ' + _rand(H)
      + '" stroke="' + palette[_rand(palette.length)] + '" stroke-width="1" fill="none" opacity="0.5"/>');
  }
  /* 噪点 22 个 */
  for (let i = 0; i < 22; i++) {
    parts.push('<circle cx="' + _rand(W) + '" cy="' + _rand(H) + '" r="' + (0.5 + _rand(12) / 10).toFixed(1)
      + '" fill="' + palette[_rand(palette.length)] + '" opacity="0.45"/>');
  }
  /* 字符：5x7 点阵，像素块带波形纵向偏移 + 微抖动，整字旋转 ±18°
     字距铁律（2026-09-04 校准实测根治）：旋转后包围盒 = w·cosθ+h·sinθ ≈ 15×0.95+21×0.31 ≈ 20.8px，
     字距 pitch 必须 > 包围盒 + 抖动余量，否则相邻字像素互串（C 被邻字像素补成 G）——gap=10 → pitch=25 */
  const px = 3, gap = 10, gw = 5 * px, gh = 7 * px;
  let x0 = (W - (text.length * gw + (text.length - 1) * gap)) / 2;
  for (let i = 0; i < text.length; i++) {
    const rows = FONT[text[i]];
    if (!rows) continue;
    const rot = _rand(37) - 18;
    const phase = _rand(628) / 100;
    const col = palette[_rand(palette.length)];
    const cx = x0 + gw / 2, cy = H / 2;
    const cells = [];
    for (let r = 0; r < 7; r++) {
      /* 波形振幅 0.7px：须远小于半格（1.5px），否则像素越行致 E/F、6/G、8/B 误读（2026-09-04 实测校准 4/8 的根治） */
      const wave = Math.sin(r * 0.85 + phase) * 0.7;
      for (let c = 0; c < 5; c++) {
        if (rows[r][c] === '1') {
          const jx = _rand(11) / 10 - 0.5, jy = _rand(11) / 10 - 0.5;
          cells.push('<rect x="' + (x0 + c * px + jx).toFixed(1) + '" y="' + (H / 2 - gh / 2 + r * px + wave + jy).toFixed(1)
            + '" width="3" height="3" rx="0.5"/>');
        }
      }
    }
    parts.push('<g transform="rotate(' + rot + ' ' + cx.toFixed(1) + ' ' + cy + ')" fill="' + col + '">' + cells.join('') + '</g>');
    x0 += gw + gap;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
}

/* ===== 签发（含 IP 限流）=====
   返回 { captchaId, svg, ttl }；超限返回 null */
function issue(ip) {
  const now = Date.now();
  let r = _issueRate.get(ip);
  if (!r || now > r.resetAt) { r = { n: 0, resetAt: now + 60 * 1000 }; _issueRate.set(ip, r); }
  if (++r.n > ISSUE_RATE_MAX) return null;
  const id = crypto_.randomUUID();
  const text = makeText();
  _store.set(id, { text: text, exp: now + CAPTCHA_TTL });
  return { captchaId: id, svg: makeSvg(text), ttl: CAPTCHA_TTL / 1000 };
}

/* ===== 校验并一次性核销 =====
   返回 'ok' | 'missing' | 'expired' | 'wrong' */
function verify(id, input) {
  if (!id || !input) return 'missing';
  const rec = _store.get(id);
  _store.delete(id);              /* 一次性：无论对错立即销毁 */
  if (!rec) return 'expired';
  if (Date.now() > rec.exp) return 'expired';
  return String(input).trim().toUpperCase() === rec.text ? 'ok' : 'wrong';
}

/* ===== 登录失败限流（密码类失败才计数）===== */
function lockRemainingMin(ip) {
  const rec = _loginFails.get(ip);
  if (rec && rec.lockUntil && Date.now() < rec.lockUntil) return Math.ceil((rec.lockUntil - Date.now()) / 60000);
  return 0;
}
function failRecord(ip) {
  const now = Date.now();
  let rec = _loginFails.get(ip);
  if (!rec || (rec.lockUntil && now >= rec.lockUntil)) rec = { n: 0, lockUntil: 0 };
  rec.n++;
  if (rec.n >= FAIL_MAX) {
    rec.lockUntil = now + LOCK_MS;
    _loginFails.set(ip, rec);
    return { locked: true, left: 0 };
  }
  _loginFails.set(ip, rec);
  return { locked: false, left: FAIL_MAX - rec.n };
}
function clearFails(ip) { _loginFails.delete(ip); }

/* ===== 后台清扫（每分钟）===== */
const _sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _store) { if (now > v.exp) _store.delete(k); }
  for (const [k, v] of _issueRate) { if (now > v.resetAt + 60000) _issueRate.delete(k); }
  for (const [k, v] of _loginFails) { if ((!v.lockUntil || now > v.lockUntil) && now > (v.lockUntil || 0) + LOCK_MS) _loginFails.delete(k); }
}, 60 * 1000);
if (_sweeper.unref) _sweeper.unref();

module.exports = {
  issue: issue,
  verify: verify,
  lockRemainingMin: lockRemainingMin,
  failRecord: failRecord,
  clearFails: clearFails,
  makeSvg: makeSvg,
  makeText: makeText,
  /* 仅供单元测试探测内部状态 */
  _store: _store,
  _loginFails: _loginFails,
  CAPTCHA_TTL: CAPTCHA_TTL,
  FAIL_MAX: FAIL_MAX,
  LOCK_MS: LOCK_MS
};
