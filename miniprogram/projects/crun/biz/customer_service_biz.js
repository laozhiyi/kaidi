// 在线客服入口（我的、关于、发布页、订单详情）统一走这里。
// 客服暂未开放（OPEN=false）时，入口显示为「反馈与投诉」并打开反馈页，「我的」页的客服格子隐藏；
// 开放时把 OPEN 改为 true，入口恢复为在线客服并跳转会话页。
const CHAT_URL = '/projects/crun/pages/customer_service/chat/customer_service_chat';
const FEEDBACK_URL = '/projects/crun/pages/feedback/index/feedback_index';
const OPEN = false;

// orderId 仅在当前用户参与该订单时传入，反馈页会核实订单归属。
function openCustomerService(orderId) {
	if (OPEN) return wx.navigateTo({ url: CHAT_URL });
	wx.navigateTo({ url: FEEDBACK_URL + (orderId ? '?orderId=' + encodeURIComponent(orderId) : '') });
}

module.exports = { openCustomerService, CHAT_URL, FEEDBACK_URL, OPEN };
