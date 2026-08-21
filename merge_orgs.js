/**
 * 威胁组织数据合并脚本
 * 用法: node merge_orgs.js [orgs.jsonl]
 * 说明: 读取 new_orgs.jsonl（每行一个组织对象，占位符行会被过滤），
 *       合并进 threats.js 的 THREAT_DATA.organizations 数组，
 *       更新 index.html 中 threats.js 的版本号，并运行 node --check。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const baseDir = __dirname;
const threatsPath = path.join(baseDir, 'threats.js');
const indexPath = path.join(baseDir, 'index.html');
const orgsPath = process.argv[2] ? path.resolve(baseDir, process.argv[2]) : path.join(baseDir, 'new_orgs.jsonl');
const nodeExe = '"C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2/node.exe"';

// 1. 读取原始 threats.js
let threatsContent = fs.readFileSync(threatsPath, 'utf8');

// 2. 定位 THREAT_DATA.organizations 数组边界
const startMarker = 'const THREAT_DATA={organizations:[';
const startIdx = threatsContent.indexOf(startMarker);
if (startIdx === -1) throw new Error('未找到 THREAT_DATA.organizations 数组起始标记');
let bracketCount = 0;
let inString = false;
let escape = false;
let arrayStart = startIdx + startMarker.length - 1; // 指向 '['
let arrayEnd = -1;
for (let i = arrayStart; i < threatsContent.length; i++) {
  const ch = threatsContent[i];
  if (escape) { escape = false; continue; }
  if (ch === '\\') { escape = true; continue; }
  if (ch === '"' && (i === 0 || threatsContent[i-1] !== '\\')) inString = !inString;
  if (!inString) {
    if (ch === '[') bracketCount++;
    else if (ch === ']') {
      bracketCount--;
      if (bracketCount === 0) { arrayEnd = i; break; }
    }
  }
}
if (arrayEnd === -1) throw new Error('未找到 THREAT_DATA.organizations 数组结束标记');

// 3. 解析原数组（JS 对象字面量，不是 JSON，使用 vm）
let existing;
try {
  const ctx = { console, Array, Object, String, Number, Boolean, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite };
  const scriptCode = threatsContent.replace(/\bconst\s+THREAT_DATA\s*=/, 'THREAT_DATA =');
  vm.runInNewContext(scriptCode, ctx, { filename: threatsPath, timeout: 5000 });
  existing = ctx.THREAT_DATA.organizations;
} catch (e) {
  throw new Error('解析原 threats.js 失败: ' + e.message);
}
if (!Array.isArray(existing)) throw new Error('THREAT_DATA.organizations 不是数组');

// 4. 读取新组织数据
let newOrgs = [];
if (fs.existsSync(orgsPath)) {
  const lines = fs.readFileSync(orgsPath, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.includes('<!--END-->'));
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      // 兼容 JS 对象字面量（属性名无引号、单引号字符串等）
      try {
        obj = vm.runInNewContext('(' + line + ')', { console, Array, Object, String, Number, Boolean, Date }, { timeout: 1000 });
      } catch (e2) {
        throw new Error(`解析 JSONL/JS 行失败: ${line.slice(0,80)}... \n错误: ${e.message}`);
      }
    }
    if (obj && obj.id) newOrgs.push(obj);
  }
}

// 5. 数据校验
const requiredFields = ['id','name','type','category','status','threatLevel','description','operatingRegions'];
const missing = [];
for (const o of newOrgs) {
  for (const f of requiredFields) {
    if (o[f] === undefined || o[f] === null || o[f] === '') {
      missing.push(`${o.id || '?'} 缺少 ${f}`);
    }
  }
}
if (missing.length) {
  console.error('数据校验失败:\n' + missing.slice(0,20).join('\n'));
  process.exit(1);
}

if (newOrgs.length === 0) {
  console.log('没有新组织数据，未修改 threats.js 和 index.html。');
  process.exit(0);
}

// 6. 去重合并（以 id 为准，新数据覆盖旧数据）
const map = new Map();
for (const o of existing) map.set(o.id, o);
for (const o of newOrgs) map.set(o.id, o);
const merged = Array.from(map.values());

// 7. 写回 threats.js
const newArrayBody = merged.map(o => JSON.stringify(o)).join(',\n');
const newThreatsContent = threatsContent.slice(0, arrayStart + 1) + '\n' + newArrayBody + '\n' + threatsContent.slice(arrayEnd);
fs.writeFileSync(threatsPath, newThreatsContent, 'utf8');
console.log(`已合并 ${newOrgs.length} 个新组织，当前组织总数: ${merged.length}`);

// 8. 更新 index.html 版本号
let indexContent = fs.readFileSync(indexPath, 'utf8');
indexContent = indexContent.replace(/(<script src="threats\.js\?v=)(\d+)(")/, (m, p1, p2, p3) => {
  const newVer = parseInt(p2, 10) + 1;
  console.log(`index.html 版本号已更新: v${p2} -> v${newVer}`);
  return p1 + newVer + p3;
});
fs.writeFileSync(indexPath, indexContent, 'utf8');

// 9. 语法检查
try {
  execSync(`${nodeExe} --check "${threatsPath}"`, { stdio: 'inherit' });
  console.log('node --check 语法检查通过');
} catch (e) {
  console.error('node --check 语法检查失败');
  process.exit(1);
}
