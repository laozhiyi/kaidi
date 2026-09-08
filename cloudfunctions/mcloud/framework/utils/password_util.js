'use strict';
const crypto = require('crypto');
function assertStrong(password) {
 if (typeof password !== 'string' || !password.length) throw new Error('密码不能为空');
}
function hash(password) { assertStrong(password); const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + salt + '$' + crypto.scryptSync(password, salt, 64).toString('hex'); }
function verify(password, stored) {
 if (typeof password !== 'string' || !password.length || typeof stored !== 'string') return false;
 const parts = stored.split('$'); if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
 const actual = crypto.scryptSync(password, parts[1], 64); return crypto.timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
module.exports = { hash, verify, assertStrong };
