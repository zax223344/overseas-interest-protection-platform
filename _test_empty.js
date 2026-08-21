const fs = require('fs');
const s = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/server/server.js', 'utf8');
const block = s.match(/const _TITLE_CORE_PLACES =[\s\S]*?function _completeTitle\(it\) \{[\s\S]*?\n\}/)[0];
eval(block);
function test(title, content) {
  const it = { title, content };
  console.log('IN :', title);
  _completeTitle(it);
  console.log('OUT:', it.title_zh || it.title);
  console.log('---');
}
test('尽管存在分歧，中国的Xi和德国的Merz寻求在动荡时期加深关系', '');
test('印度新闻实时更新，2026年8月19日：艾德突袭毛拉纳·穆罕默德·阿里·焦哈尔信托基金会，这所大学与北方邦的阿扎姆汗有联系', '');
test('BRI-东盟接触：建立平衡，包容和可持续的伙伴关系', '');
test('阿联酋在导弹袭击后暂停与伊朗的所有贸易关系', '');
test('印度新闻实时更新，2026年8月17日：CID突袭贾坎德工作人员选拔委员会办公室，指控考试违规行为', '');
