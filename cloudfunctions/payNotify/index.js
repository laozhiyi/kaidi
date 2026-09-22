'use strict';
// Offline settlement only. A client-callable event is not proof of payment.
// Re-enable only with verified WeChat signatures and reconciliation.
exports.main = async () => ({ errcode: -1, errmsg: 'PAYMENT_DISABLED' });
