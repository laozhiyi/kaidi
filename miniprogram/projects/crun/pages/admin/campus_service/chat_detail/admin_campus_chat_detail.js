const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const createChatPage = require('../../../campus_service/chat/chat_page.js');

Page(createChatPage({
	idKey: 'sessionId',
	getRoute: 'admin/campus_chat_detail',
	sendRoute: 'admin/campus_chat_reply',
	ownSender: 'admin',
	init(page) { return AdminBiz.isAdmin(page); }
}));
