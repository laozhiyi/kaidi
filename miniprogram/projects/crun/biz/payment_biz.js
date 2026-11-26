const Ops = require('./operations_biz.js');
// 每次拉起微信支付前都弹出的说明；云端 operations/config 的 paymentNotice 使用同一段文字。
const PAY_NOTICE = '发布时微信支付跑腿费，支付确认后订单才会发布。平台抽成10%，订单完成后骑手实得跑腿费的90%。代买商品款另行结算；接单前取消或无人接单超时原路退款。';
function confirmNotice() {
 return new Promise(resolve => wx.showModal({ title: '支付说明', content: PAY_NOTICE, confirmText: '去支付', cancelText: '再想想',
  success: res => resolve(!!res.confirm), fail: () => resolve(false) }));
}
async function pay(id) {
 // Reconcile before creating another prepay request: a prior UI may have closed after payment.
 const previous = await Ops.get('mail/payment_status', {id});
 if (previous.published) return previous;
 if (previous.status !== -1) throw new Error('订单已关闭或状态已变化，请查看订单详情');
 if (!await confirmNotice()) throw new Error('支付已取消，订单尚未发布，可在订单详情继续支付');
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
