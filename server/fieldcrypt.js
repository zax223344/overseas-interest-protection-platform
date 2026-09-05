/**
 * fieldcrypt.js — 敏感字段级加密（AES-256-GCM，2026-09-04 P1-3）
 * ============================================================
 * 用途：通讯录电话/邮箱等 PII 字段落库前加密——库被拖也读不出明文。
 * 算法：AES-256-GCM（认证加密，防篡改）；密钥 DATA_FIELD_KEY（.env，64 hex=32 字节），
 * 与 JWT_SECRET 完全分离（密钥分层铁律）。
 * 密文格式：enc:v1:<iv12B><tag16B><ciphertext>（base64），前缀可识别幂等。
 * ============================================================
 */
'use strict';
const crypto = require('crypto');

const _keyHex = process.env.DATA_FIELD_KEY || '';
const KEY = /^[0-9a-f]{64}$/i.test(_keyHex) ? Buffer.from(_keyHex, 'hex') : null;
const PREFIX = 'enc:v1:';

function available() { return !!KEY; }

function encrypt(plain) {
  if (plain == null || plain === '' || !KEY) return plain;
  const s = String(plain);
  if (s.startsWith(PREFIX)) return s;              /* 幂等：已加密不重复加密 */
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(enc) {
  if (enc == null || enc === '' || !KEY) return enc;
  const s = String(enc);
  if (!s.startsWith(PREFIX)) return s;             /* 非密文原样返回（兼容存量明文） */
  try {
    const buf = Buffer.from(s.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) { return s; }                        /* 解密失败原样返回（不误伤数据） */
}

/* 对象数组指定字段批量加解密（state.contacts 场景） */
function encryptRows(rows, fields) {
  if (!Array.isArray(rows) || !KEY) return rows;
  return rows.map(r => {
    if (!r || typeof r !== 'object') return r;
    const o = Object.assign({}, r);
    fields.forEach(f => { if (o[f]) o[f] = encrypt(o[f]); });
    return o;
  });
}
function decryptRows(rows, fields) {
  if (!Array.isArray(rows) || !KEY) return rows;
  return rows.map(r => {
    if (!r || typeof r !== 'object') return r;
    const o = Object.assign({}, r);
    fields.forEach(f => { if (o[f]) o[f] = decrypt(o[f]); });
    return o;
  });
}

module.exports = { encrypt, decrypt, encryptRows, decryptRows, available, PREFIX };
