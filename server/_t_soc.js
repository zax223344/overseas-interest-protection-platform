const social=require('./social');
(async()=>{
  console.log('--- Telegram 单频道实测 ---');
  const tg=await social.fetchTelegram({user:'bbcbreaking',name:'BBC Breaking News',tag:'国际突发'},10);
  console.log('fetched=',tg.items.length,'err=',tg.error);
  if(tg.items[0])console.log('  样例:',tg.items[0].rawTitle.slice(0,90));
  console.log('--- HN 检索实测 ---');
  const hn=await social.fetchHackerNews('Chinese workers attack',10);
  console.log('fetched=',hn.items.length,'err=',hn.error);
  if(hn.items[0])console.log('  样例:',hn.items[0].rawTitle.slice(0,90));
})();
