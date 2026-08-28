/* 实测搜狗微信检索：刺猬安全出海 vs 刺猬安全 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const w = require('./wechat-oa.js');
(async () => {
  for (const name of ['刺猬安全出海', '刺猬安全']) {
    try {
      const r = w._internals && w._internals.sogouSearch ? await w._internals.sogouSearch(name) : null;
      if (!r) { console.log(name, '=> 模块未导出 sogouSearch，改用 collect 单账号实测'); 
        const res = await w.collect({ accounts: [name] });
        console.log(' stats:', JSON.stringify(res.stats));
        (res.items || []).slice(0, 8).forEach(x => console.log(' -', (x.date || '').slice(0, 16), '|', (x.title || '').slice(0, 60)));
        break;
      }
      console.log('===', name, '===');
      if (r.error) console.log('ERR:', r.error, 'antispider:', !!r.antispider);
      (r.list || []).slice(0, 8).forEach(x => console.log(' -', x.ts ? new Date(x.ts).toISOString().slice(0, 16) : '(无时间)', '|', (x.title || '').slice(0, 60), '|', x.account || ''));
      if (!(r.list || []).length) console.log(' (0 条结果)');
    } catch (e) { console.log(name, 'EX:', e.message); }
    await new Promise(r2 => setTimeout(r2, 9000));
  }
  process.exit(0);
})();
