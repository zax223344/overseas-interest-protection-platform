const social=require('./social');
(async()=>{
  const t0=Date.now();
  const r=await social.searchSocial('Chinese workers',{limit:25});
  console.log('===== searchSocial("Chinese workers") 耗时',((Date.now()-t0)/1000).toFixed(1)+'s');
  console.log('通道执行:');
  r.channels.forEach(c=>console.log('   ',(c.channel+'                              ').slice(0,32),'抓取='+c.fetched,c.error?('| '+c.error):''));
  console.log('统计:',JSON.stringify(r.stats));
  r.items.slice(0,8).forEach((it,i)=>{
    console.log('  ['+(i+1)+']',(it.title||'').slice(0,88));
    console.log('      平台='+it.social_platform,'| 风险'+it.riskScore+'/'+it.alertLevel,'| 国别='+(it.country||'-'),'| 关联='+it.interestLinked,
      '| 企业'+JSON.stringify(it.rel_enterprises||[]),'| 项目'+JSON.stringify(it.rel_projects||[]));
    console.log('      来源='+it.source,'|',it.url.slice(0,72));
  });
})();
