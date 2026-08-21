const crawler = require('./crawler.js');
(async ()=>{
  const qs = ['Chinese workers attacked', 'Chinese company project suspended'];
  for (const q of qs) {
    const t0 = Date.now();
    const r = await crawler.crawlWeb(q, {max:10, maxPages:8, lang:'en', timespan:'7d'});
    console.log('\n===== 查询: ' + q + ' | 耗时 ' + ((Date.now()-t0)/1000).toFixed(1) + 's | 入库 ' + r.length + ' 条');
    r.slice(0,5).forEach((it,i)=>{
      console.log('  ['+(i+1)+'] '+(it.title||'').slice(0,90));
      console.log('      通道='+it._channel+' 源='+it.source+' 国家='+(it.country||'-')+' 正文='+((it.content||'').length)+'字 抓正文='+it._textFetched);
      console.log('      风险'+it.riskScore+'/'+it.alertLevel+' 企业['+(it.rel_enterprises||[]).join(' ')+'] 项目['+(it.rel_projects||[]).join(' ')+'] 关联='+it.interestLinked);
    });
  }
})().catch(e=>console.error('ERR', e.message, e.stack));
