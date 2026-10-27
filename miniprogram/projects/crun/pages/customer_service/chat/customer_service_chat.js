const ProjectBiz = require('../../../biz/project_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');
const createChatPage = require('./chat_page.js');

// 在线客服是兜底通道：只要求微信身份，不要求补齐学生资料或通过审核。
// 老用户直接复用会话；首次进入的用户在这里静默完成一次微信登录再发消息。
async function enter(page) {
	if (Passport.isLoggedOut()) return await Passport.loginMustCancelWin(page);
	const token = Passport.getToken();
	if (token && token.id && token.status !== 9) return true;
	try {
		await Passport.loginByUser(page);
		return true;
	} catch (err) {
		if (!page._destroyed) {
			page.setData({ isLoad: true, service: null, errorText: (err && (err.msg || err.message)) || '微信登录未完成，请重试' });
		}
		return false;
	}
}

Page(createChatPage({
	idKey: '',
	getRoute: 'customer_service/chat',
	sendRoute: 'customer_service/send',
	ownSender: 'user',
	init(page) {
		ProjectBiz.initPage(page);
		return true;
	},
	beforeShow: enter,
	async onRetry(page) {
		page.setData({ isLoad: false, errorText: '' });
		if (await enter(page)) return page._loadMessages();
	},
	onLoaded(page) {
		// 用户侧订阅提醒：配置了客服模板才请求，失败不影响会话。
		const Ops = require('../../../biz/operations_biz.js');
		if (Ops.subscribeChat) Ops.subscribeChat().catch(() => { });
	}
}));
