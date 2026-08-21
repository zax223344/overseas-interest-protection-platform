/**
 * 海外利益保护情报预警平台 - API 客户端
 * 桥接前端与 PostgreSQL 后端，保留 localStorage 作为离线回退
 */
var APIClient = {
  _baseUrl: '',       // 动态探测或手动配置
  _token: null,
  _userId: null,
  _online: null,      // null=未探测, true=在线, false=离线
  _localFallback: true,  // 离线时是否回退到 localStorage

  /**
   * 初始化：探测后端地址，尝试健康检查
   * @param {string} baseUrl - 可选，手动指定后端地址
   */
  init: function(baseUrl) {
    // 优先使用传入的地址，其次从前端页面检测
    if (baseUrl) {
      this._baseUrl = baseUrl;
    } else if (window.location.protocol === 'file:' || !/^https?:/.test(window.location.origin || '')) {
      // file:// 双击打开页面时 origin 无效 → 回退到本地后端，保证 API 可达
      this._baseUrl = 'http://localhost:3000';
    } else {
      // 自动检测：如果当前页面不是后端提供，则为静态文件模式，尝试相对路径
      this._baseUrl = window.location.origin;
    }

    // 恢复 token
    try { this._token = localStorage.getItem('orps_api_token') || null; } catch(e) {}

    // 异步探测后端
    this._probe();

    console.log('[APIClient] 初始化完成, 后端地址:', this._baseUrl);
  },

  /** 设置后端地址 */
  setBaseUrl: function(url) { this._baseUrl = url; this._probe(); },

  /** 检测后端连通性 */
  _probe: function() {
    var self = this;
    fetch(this._baseUrl + '/api/health')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        /* 服务器可达即视为在线；PostgreSQL 未连接只是「降级模式」（仍可用 localStorage + 公开态势通道），不应判为离线 */
        self._online = true;
        self._dbOnline = !!(data && data.database === 'connected');
        if (self._dbOnline) {
          console.log('[APIClient] 后端在线 (PostgreSQL 已连接)');
        } else {
          console.log('[APIClient] 后端在线（数据库未连接，使用本地存储 + 公开态势通道降级模式）');
        }
      })
      .catch(function() {
        self._online = false;
        self._dbOnline = false;
        console.warn('[APIClient] 后端不可达，将使用 localStorage 本地存储');
      });
  },

  /** 是否在线 */
  isOnline: function() { return this._online === true; },

  /** 数据库是否在线（离线时跳过 API 登录，直接走 localStorage 本地账号） */
  isDBOnline: function() { return this._dbOnline === true; },

  /** 通用 fetch 封装 */
  _fetch: function(method, path, body, noAuth) {
    var self = this;
    var headers = { 'Content-Type': 'application/json' };
    if (!noAuth && this._token) {
      headers['Authorization'] = 'Bearer ' + this._token;
    }

    var opts = { method: method, headers: headers };
    if (body !== undefined && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    return fetch(this._baseUrl + path, opts)
      .then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok) {
            var err = new Error(data.error || 'API请求失败 (' + r.status + ')');
            err.status = r.status;
            throw err;
          }
          return data;
        });
      });
  },

  /** 保存 token */
  _saveToken: function(token) {
    this._token = token;
    try { localStorage.setItem('orps_api_token', token); } catch(e) {}
  },

  /** 清除 token */
  _clearToken: function() {
    this._token = null;
    try { localStorage.removeItem('orps_api_token'); } catch(e) {}
  },

  /** 获取 token */
  getToken: function() { return this._token; },

  // ================================================================
  // 认证 API
  // ================================================================
  login: function(username, password) {
    return this._fetch('POST', '/api/auth/login', { username: username, password: password }, true)
      .then(function(data) {
        APIClient._saveToken(data.token);
        return data;
      });
  },

  register: function(username, password) {
    return this._fetch('POST', '/api/auth/register', { username: username, password: password }, true);
  },

  createTrial: function(username, password, days) {
    return this._fetch('POST', '/api/auth/trial', { username: username, password: password, days: days || 7 }, true)
      .then(function(data) {
        if (data.token) APIClient._saveToken(data.token);
        return data;
      });
  },

  renewTrial: function(username, days) {
    return this._fetch('POST', '/api/auth/renew-trial', { username: username, days: days });
  },

  checkAuth: function() {
    return this._fetch('GET', '/api/auth/check');
  },

  logout: function() {
    this._clearToken();
  },

  // ================================================================
  // 用户管理 API
  // ================================================================
  listUsers: function() { return this._fetch('GET', '/api/users'); },

  approveUser: function(username) { return this._fetch('PUT', '/api/users/' + encodeURIComponent(username) + '/approve'); },

  rejectUser: function(username) { return this._fetch('PUT', '/api/users/' + encodeURIComponent(username) + '/reject'); },

  setRole: function(username, role) { return this._fetch('PUT', '/api/users/' + encodeURIComponent(username) + '/role', { role: role }); },

  deleteUser: function(username) { return this._fetch('DELETE', '/api/users/' + encodeURIComponent(username)); },

  resetPassword: function(username, password) { return this._fetch('PUT', '/api/users/' + encodeURIComponent(username) + '/password', { password: password }); },

  // ================================================================
  // 情报数据 API (DBCenter)
  // ================================================================
  getIntel: function(type) { return this._fetch('GET', '/api/intel/' + type); },

  addIntel: function(type, item) { return this._fetch('POST', '/api/intel/' + type, item); },

  addIntelBatch: function(type, items) { return this._fetch('POST', '/api/intel/' + type + '/batch', items); },

  updateIntel: function(id, item) { return this._fetch('PUT', '/api/intel/' + id, item); },

  auditIntel: function(id, status) { return this._fetch('PUT', '/api/intel/' + id + '/audit', { status: status }); },

  deleteIntel: function(id) { return this._fetch('DELETE', '/api/intel/' + id); },

  clearIntel: function(type) { return this._fetch('DELETE', '/api/intel/' + type + '/all'); },

  // ================================================================
  // DataHub 数据集 API
  // ================================================================
  getDataHub: function(collection) { return this._fetch('GET', '/api/datahub/' + collection); },

  saveDataHub: function(collection, data) { return this._fetch('PUT', '/api/datahub/' + collection, data); },

  // ================================================================
  // AI 报告 API
  // ================================================================
  listReports: function() { return this._fetch('GET', '/api/reports'); },

  getReport: function(id) { return this._fetch('GET', '/api/reports/' + id); },

  createReport: function(report) { return this._fetch('POST', '/api/reports', report); },

  updateReport: function(id, report) { return this._fetch('PUT', '/api/reports/' + id, report); },

  deleteReport: function(id) { return this._fetch('DELETE', '/api/reports/' + id); },

  // ================================================================
  // 其他模块 API
  // ================================================================
  getThreatOrgs: function() { return this._fetch('GET', '/api/threat-orgs'); },
  saveThreatOrgs: function(data) { return this._fetch('PUT', '/api/threat-orgs', data); },

  getEnterpriseProjects: function() { return this._fetch('GET', '/api/enterprise-projects'); },
  saveEnterpriseProjects: function(data) { return this._fetch('PUT', '/api/enterprise-projects', data); },

  getRiskFusion: function() { return this._fetch('GET', '/api/risk-fusion'); },
  saveRiskFusion: function(data) { return this._fetch('PUT', '/api/risk-fusion', data); },

  getAutoAlerts: function() { return this._fetch('GET', '/api/auto-alerts'); },
  saveAutoAlerts: function(data) { return this._fetch('PUT', '/api/auto-alerts', data); },

  getAuditLogs: function(limit) { return this._fetch('GET', '/api/audit-logs?limit=' + (limit || 200)); },
  addAuditLog: function(data) { return this._fetch('POST', '/api/audit-logs', data); },

  getThreatAssessments: function(type) { return this._fetch('GET', '/api/threat-assessments/' + type); },
  saveThreatAssessments: function(type, data) { return this._fetch('PUT', '/api/threat-assessments/' + type, data); },

  getCollected: function(sourceType) { return this._fetch('GET', '/api/collected/' + sourceType); },
  saveCollected: function(sourceType, data) { return this._fetch('PUT', '/api/collected/' + sourceType, data); },

  getSetting: function(key) { return this._fetch('GET', '/api/settings/' + key); },
  saveSetting: function(key, data) { return this._fetch('PUT', '/api/settings/' + key, data); }
};
