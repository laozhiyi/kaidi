'use strict';
const Base = require('./base_project_service.js');
const Mail = require('./mail_service.js');
const store = require('./operation_store.js');
const ORDER_ACTIONS = {
 'mail/insert': 'publish', 'mail/edit': 'edit', 'mail/accept': 'accept',
 'mail/pickup': 'pickup', 'mail/cancel': 'cancel', 'mail/deliver': 'deliver',
 'mail/update_proof': 'update_proof',
 'mail/finish': 'confirm', 'mail/exception': 'exception', 'mail/del': 'archive',
 'admin/operations_hold': 'hold', 'admin/operations_resolve': 'resolve',
 'admin/operations_delete_order': 'admin_delete'
};

// Resolve an unknown response without storing personal form contents on a phone.
// Closing an absent request and the original write both read/write the same
// cancellation document inside transactions. Exactly one outcome can commit.
class RequestRecoveryService extends Base {
 async recover(userId, input, adminId = '') {
  const {route, requestId, id = ''} = input, pid = this.getProjectId();
  const action = Object.prototype.hasOwnProperty.call(ORDER_ACTIONS, route) ? ORDER_ACTIONS[route] : '';
  const supported = !!action || ['feedback/insert', 'review/insert', 'admin/feedback_reply'].includes(route);
  if (!supported || route.startsWith('admin/') !== !!adminId) this.AppError('不支持核对该操作');
  if ((action && action !== 'publish' || route === 'admin/feedback_reply') && !id) this.AppError('缺少需要核对的记录编号');
  const mailService = new Mail(); mailService._request(requestId);
  const actor = adminId ? {adminId} : {userId, user:await mailService._user(userId)};
  const identity = adminId || userId, requestKey = store.key(pid, identity, requestId);
  return store.transaction(async tx => {
   await mailService._actor(tx, actor);
   await store.assertRequestScope(tx,pid,identity,route,requestId);
   let result = null;
   if (action) {
    const seen = await store.get(tx, 'order_request', requestKey);
    // Also tolerate a historical publication whose request record was absent.
    const row = await store.get(tx, 'mail', action === 'publish' ? requestKey : id);
    if (seen) {
     if (seen._pid !== pid || seen.action !== action || action !== 'publish' && seen.orderId !== id) this.AppError('请求标识与操作不匹配');
     if (!row || row._pid !== pid || seen.orderId !== row._id) this.AppError('订单记录暂不可用，请联系管理员核对');
     result = action === 'publish' ? {id:row.MAIL_ID,_id:row._id} : {id:row._id};
    } else if (action === 'publish' && row) {
     if (row._pid !== pid || row.MAIL_USER_ID !== userId) this.AppError('无权限核对该订单');
     result = {id:row.MAIL_ID,_id:row._id};
    }
   } else if (route === 'feedback/insert') {
    const row = await store.get(tx, 'feedback', requestKey);
    if (row) {
     if (row._pid !== pid || row.FB_USER_ID !== userId) this.AppError('无权限核对该反馈');
     result = {id:requestKey};
    }
   } else if (route === 'admin/feedback_reply') {
    const row = await store.get(tx, 'feedback_request', requestKey);
    if (row) {
     if (row._pid !== pid || row.id !== id) this.AppError('请求标识与反馈不匹配');
     result = {id:row.id};
    }
   } else {
    const row = await store.get(tx, 'review_request', requestKey);
    if (row) {
     if (row._pid !== pid) this.AppError('无权限核对该评价');
     result = {id:row.reviewId,alreadyReviewed:true};
    }
   }
   if (result) return {state:'committed',result};
   const scope=store.scope();
   if(scope)await store.set(tx,'request_scope',store.key(pid,'cancelled',identity,route,requestId),{_pid:pid,schoolId:scope.schoolId,campusId:scope.campusId});
   await store.set(tx, 'order_request', store.key(pid, 'cancelled', identity, route, requestId), {
    _pid:pid, state:'cancelled', route, createdAt:Date.now()
   });
   return {state:'cancelled'};
  });
 }
}
module.exports = RequestRecoveryService;
