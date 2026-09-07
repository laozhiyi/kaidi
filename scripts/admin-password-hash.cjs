'use strict';
// Offline only: generates a replacement hash. Never connects to or updates a database.
const password = process.env.ADMIN_RESET_PASSWORD;
delete process.env.ADMIN_RESET_PASSWORD;
try {
 const hash = require('../cloudfunctions/mcloud/framework/utils/password_util.js').hash(password);
 process.stdout.write(JSON.stringify({ADMIN_PASSWORD:hash,ADMIN_TOKEN:'',ADMIN_TOKEN_USER:'',ADMIN_TOKEN_TIME:0},null,2)+'\n');
} catch (_) {
 console.error('Set ADMIN_RESET_PASSWORD to a 12-128 character password containing letters and numbers. No password was printed.');
 process.exitCode=1;
}
