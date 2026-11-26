const Ops = require('./operations_biz.js');
const SETTLEMENT_PAGE = '/projects/crun/pages/my/settlement/settlement';
// 接取在线支付（AdaPay）订单前先确认本人已开通跑腿结算、绑定了银行卡；
// 没有绑定就提示后直接进入「跑腿结算」页面去添加银行卡，本次不接单。云端接单时仍会再校验一次。
async function ensureSettlement(order) {
	if (!order || order.MAIL_PAYMENT_MODE !== 'adapay') return true;
	const account = await Ops.get('settlement/status');
	if (account && account.opened === true) return true;
	await new Promise(resolve => wx.showModal({
		title: '请先绑定银行卡',
		content: '接单前需要先开通跑腿结算并绑定本人银行卡，订单完成后的报酬会结算到这张卡。',
		showCancel: false, confirmText: '去绑定',
		complete: resolve
	}));
	wx.navigateTo({ url: SETTLEMENT_PAGE });
	return false;
}
module.exports = { ensureSettlement, SETTLEMENT_PAGE };
