const fs = require('fs');
const vm = require('vm');
const line = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs.jsonl','utf8').split(/\r?\n/)[0];
try {
  const obj = vm.runInNewContext('(' + line + ')', { console, Array, Object, String, Number, Boolean, Date }, { timeout: 1000 });
  console.log('vm OK', obj.id, obj.name);
} catch (e) {
  console.error('vm FAIL', e.message);
}
