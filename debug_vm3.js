const fs = require('fs');
const vm = require('vm');
const line = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs.jsonl','utf8').split(/\r?\n/)[0];
let good = 0, bad = line.length;
while (good < bad) {
  const mid = Math.floor((good + bad + 1) / 2);
  const frag = line.slice(0, mid);
  try {
    vm.runInNewContext('(' + frag + ')', { console, Array, Object, String, Number, Boolean, Date }, { timeout: 1000 });
    good = mid;
  } catch (e) {
    bad = mid - 1;
  }
}
console.log('longest valid prefix length:', good);
console.log('next chars:', JSON.stringify(line.slice(good, good+100)));
