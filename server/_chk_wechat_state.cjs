/* 查公众号采集状态：刺猬安全出海最近seen标题+轮巡偏移 */
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '.cache', 'wechat-oa-state.json');
const st = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('rotOffset:', st._rotOffset);
const names = Object.keys(st).filter(k => k !== '_rotOffset');
console.log('accounts in state:', names.length);
for (const n of names) {
  const seen = (st[n] && st[n].seenTitles) || [];
  const mark = n.includes('刺猬') ? ' <<<' : '';
  console.log(n, '=> seen', seen.length, 'titles', mark);
  if (n.includes('刺猬')) {
    seen.slice(-15).forEach(t => console.log('   -', t));
  }
}
