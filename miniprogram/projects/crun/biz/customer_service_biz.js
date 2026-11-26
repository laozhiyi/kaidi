// 在线客服入口（我的、关于、发布页、订单详情）统一走这里。
// 客服暂未开放：点击只提示「待开发」；开放时把 OPEN 改为 true，入口恢复跳转会话页。
const CHAT_URL = '/projects/crun/pages/customer_service/chat/customer_service_chat';
const OPEN = false;

function openCustomerService() {
	if (!OPEN) return wx.showToast({ title: '待开发', icon: 'none' });
	wx.navigateTo({ url: CHAT_URL });
}

module.exports = { openCustomerService, CHAT_URL, OPEN };
