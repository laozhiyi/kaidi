'use strict';
// 与小程序 public/agreements.js 的正文版本一起发布。
const VERSION = '2026-11-27';
const currentUser = record => !!record && record.userVersion === VERSION && record.privacyVersion === VERSION && record.acceptedAt > 0;
const currentRider = record => !!record && record.consentVersion === VERSION && record.authorizationVersion === VERSION && record.consentedAt > 0;
function userConsent(previous, input, now) {
 if (input && input.accepted === true && input.userVersion === VERSION && input.privacyVersion === VERSION) {
  return currentUser(previous) ? previous : {userVersion:VERSION,privacyVersion:VERSION,acceptedAt:now};
 }
 // 没有重新提交协议字段的普通资料编辑可复用历史记录；明确拒绝或过期版本不能被历史同意覆盖。
 if (input === undefined && currentUser(previous)) return previous;
 throw new Error('请阅读并同意当前版本的用户服务协议及隐私政策');
}
function requireRider(input) {
 if (!input || input.rulesAccepted !== true || input.authorizationAccepted !== true || input.rulesVersion !== VERSION || input.authorizationVersion !== VERSION) {
  throw new Error('请阅读并同意当前版本的骑手服务与结算协议及实名信息授权');
 }
}
module.exports = {VERSION,currentUser,currentRider,userConsent,requireRider};
