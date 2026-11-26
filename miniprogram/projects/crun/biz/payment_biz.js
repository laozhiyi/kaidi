const Ops = require('./operations_biz.js');
// 支付说明：只在用户点开「微信支付说明」时显示，拉起支付前不再弹窗；云端 operations/config 的 paymentNotice 使用同一段文字。
const PAY_NOTICE = '支付成功后订单才会发布。订单完成后跑腿费结算给骑手，平台从中收取10%技术服务费；取件前双方可取消，无违约金，订单关闭并申请原路退款。确认收货或送达满8小时触发分账。银行卡不会立即到账，可结算款项按账户安排在次日或下一个工作日分批打款，实际到账以支付机构和银行处理为准；支付及结算手续费由平台承担。';
async function pay(id) {
 // Reconcile before creating another prepay request: a prior UI may have closed after payment.
 const previous = await Ops.get('mail/payment_status', {id});
 if (previous.published) return previous;
 if (previous.status !== -1) throw new Error('订单已关闭或状态已变化，请查看订单详情');
 const result = await Ops.get('mail/payment_prepare', {id});
 try { await new Promise((resolve,reject)=>wx.requestPayment({...result.payment,success:resolve,fail:reject})); }
 catch(error) {
  // Cancellation is not evidence of non-payment. The backend remains authoritative.
  const status=await Ops.get('mail/payment_status',{id});
  if(status.published)return status;
  throw new Error(/cancel/i.test(error.errMsg || '')?'支付已取消，订单尚未发布，可在订单详情继续支付':'支付结果待确认，请在订单详情核对');
 }
 const status=await Ops.get('mail/payment_status',{id});
 if(!status.published)throw new Error(status.status===99?'订单已关闭，已付款项将原路退回':'支付结果确认中，请在订单详情刷新核对');
 return status;
}
module.exports={pay,PAY_NOTICE};
