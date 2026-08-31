const path = require('path');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));
const ORIG = {
  1788081600887: 'https://timesca.com/taliban-arrests-suspects-after-deadly-attacks-on-chinese-citizens-near-tajik-afghan-border/',
  1788081600959: 'https://www.afintl.com/en/202512021480',
  1788081633530: 'https://www.globaltimes.cn/page/202512/1349466.shtml',
  1788081591743: 'https://timesca.com/china-demands-that-tajikistan-protect-chinese-citizens-after-attack/',
  1788081613157: 'https://kabulnow.com/2025/11/three-chinese-workers-killed-in-attack-near-afghanistan-tajikistan-border/',
  1788081674894: 'https://www.rferl.org/a/chinese-workers-killed-tajikistan-afghanistan-border-investgiation/33634252.html',
  1788081624328: 'https://thediplomat.com/2024/12/an-alleged-coup-plot-and-a-secretive-trial-in-tajikistan/',
  1788081619810: 'https://www.rferl.org/a/tajikistan-china-worker-killed-russia-troops-mining-taliban/33611762.html',
  1788081610967: 'https://www.dvidshub.net/news/537916/rumsfeld-calls-tajikistan-solid-partner-terror-war',
  1788081616324: 'https://atlaspress.news/en/2026/08/15/tajikistan-taliban-protest-note-woman-killed-darwaz-border/',
  1788081304091: 'https://eurasianet.org/death-tolls-in-tajikistan-kyrgyzstan-fighting-lay-bare-scale-of-conflict'
};
const TITLE = {
  1788081600887: '塔利班逮捕嫌疑人后，对中国公民在塔吉克斯坦-阿富汗边境附近的致命袭击',
  1788081600959: '塔利班在杀害中国公民后寻求与塔吉克斯坦联合调查',
  1788081633530: '中国大使馆敦促国民撤离塔吉克斯坦-阿富汗边境武装袭击',
  1788081592800: '三名中国公民在塔吉克斯坦被来自阿富汗的无人机炸死',
  1788081591743: '中国要求塔吉克斯坦在袭击后保护中国公民',
  1788081613157: '三名中国工人在阿富汗-塔吉克斯坦边境附近的袭击中丧生',
  1788081674894: '谁杀了中国工人？阿富汗-塔吉克边境袭击事件发生后数周仍存在问题',
  1788081624328: '一个所谓的政变阴谋和秘密审判在塔吉克斯坦',
  1788081619810: '塔吉克斯坦拒绝与俄罗斯谈判，以守卫阿富汗边境后，对中国工人的致命袭击',
  1788081610967: '拉姆斯菲尔德称塔吉克斯坦在恐怖战争中的坚实伙伴',
  1788081616324: '塔吉克斯坦向塔利班发出抗议照会，因为一名妇女在边境附近被杀',
  1788081304091: '塔吉克斯坦的死亡人数，吉尔吉斯斯坦的战斗暴露了冲突的规模'
};
(async () => {
  let n = 0;
  for (const [id, url] of Object.entries(ORIG)) {
    const title = TITLE[id] || '';
    const tkey = 'stale:' + String(title).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    if (tkey.length < 15) continue;
    const ex = await pool.query('SELECT 1 FROM intel_tombstones WHERE tkey=$1', [tkey]);
    if (ex.rows.length) continue;
    await pool.query('INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1,$2,$3)', [tkey, url, title]);
    n++;
  }
  console.log('墓碑写入', n, '条');
  const v = await pool.query("SELECT tkey, left(title,30) AS t FROM intel_tombstones WHERE tkey LIKE 'stale:%'");
  v.rows.forEach(x => console.log(' ', x.t));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
