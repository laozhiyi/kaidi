const Ops = require('./operations_biz.js');
const Passport = require('../../../comm/biz/passport_biz.js');
const Agreements = require('../public/agreements.js');
const SETTLEMENT_PAGE = '/projects/crun/pages/my/settlement/settlement';
const currentPage = () => typeof getCurrentPages === 'function' ? getCurrentPages().slice(-1)[0] : null;
function context() {
	const userId = Passport.getUserId(), epoch = Passport.logoutEpoch(), scope = Ops.scopeKey(), page = currentPage();
	return () => userId === Passport.getUserId() && epoch === Passport.logoutEpoch() && scope === Ops.scopeKey() && (!page || currentPage() === page);
}
async function ensureUserAgreement() {
	const token = Passport.getToken();
	if (!token) throw new Error('请先登录');
	if (Agreements.currentUser(token.agreements)) return true;
	const isCurrent = context();
	// Old sessions may lack agreement metadata. Read the saved record before asking again.
	const user = await Ops.get('passport/my_detail');
	if (!isCurrent()) return false;
	if (!user || typeof user !== 'object' || !user.USER_NAME) throw new Error('资料状态暂未同步，请稍后重试');
	if (Agreements.currentUser(user.USER_AGREEMENTS)) {
		Passport.setToken({...token, agreements:user.USER_AGREEMENTS});
		return true;
	}
	Ops.error({code:1600,msg:'请到个人资料阅读并确认新版用户服务协议与隐私政策后再接单'});
	return false;
}
// 接取在线支付（AdaPay）订单前先确认本人已开通跑腿结算、绑定了银行卡；
// 没有绑定就提示后直接进入「跑腿结算」页面去添加银行卡，本次不接单。云端接单时仍会再校验一次。
async function ensureSettlement(order) {
	if (!await ensureUserAgreement()) return false;
	if (!order || order.MAIL_PAYMENT_MODE !== 'adapay') return true;
	const isCurrent = context();
	const account = await Ops.get('settlement/status');
	if (!isCurrent()) return false;
	if (!account || typeof account.opened !== 'boolean') throw new Error('结算信息加载失败，请稍后重试');
	if (account && account.opened === true && account.consentCurrent === true) return true;
	if (account.opened) {
		Ops.error({code:1600,msg:'请到跑腿结算页阅读并确认新版骑手协议'});
		return false;
	}
	const confirmed = await new Promise(resolve => wx.showModal({
		title: '请先绑定银行卡',
		content: '接单前需要先开通跑腿结算并绑定本人银行卡，订单完成后的报酬会结算到这张卡。',
		showCancel: true, confirmText: '去绑定', cancelText: '暂不处理',
		success: result => resolve(!!result.confirm), fail: () => resolve(false)
	}));
	if (confirmed && isCurrent()) wx.navigateTo({ url: SETTLEMENT_PAGE });
	return false;
}
module.exports = { ensureSettlement, ensureUserAgreement, SETTLEMENT_PAGE };
