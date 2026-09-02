/* 独立冒烟测试：3100 端口 = 前端静态 + models-analysis 路由 + 其余 API 代理到 3000 */
process.env.HTTP_PROXY = ''; process.env.HTTPS_PROXY = ''; process.env.http_proxy = ''; process.env.https_proxy = '';
const express = require('express');
const http = require('http');
const path = require('path');
const { query } = require('./db');
const modelsAnalysis = require('./models-analysis');
const app = express();
/* json 解析只挂 models 路径：全局挂会消费 POST body，导致下方代理 req.pipe 转发空 body → 3000 挂起 408 */
app.use('/api/models', express.json({ limit: '2mb' }), modelsAnalysis({ query }));
/* 其余 /api/* 原样代理到 3000（登录、预警、态势等真实后端） */
app.use('/api', (req, res) => {
  const opt = {
    host: '127.0.0.1', port: 3000, path: req.originalUrl, method: req.method,
    headers: Object.assign({}, req.headers, { host: '127.0.0.1:3000' })
  };
  const pr = http.request(opt, prs => { res.writeHead(prs.statusCode, prs.headers); prs.pipe(res); });
  pr.on('error', e => { res.status(502).json({ ok: false, error: 'proxy:' + e.message }); });
  req.pipe(pr);
});
/* 前端静态资源（项目根目录） */
app.use(express.static(path.join(__dirname, '..')));
app.listen(3100, () => console.log('test server on 3100 (static + models api + proxy)'));
