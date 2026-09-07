const ProjectBiz = require('../../../biz/project_biz.js');
const createChatPage = require('./chat_page.js');

Page(createChatPage({
	idKey: 'serviceId',
	getRoute: 'campus_service/chat',
	sendRoute: 'campus_service/send',
	ownSender: 'user',
	init(page) {
		ProjectBiz.initPage(page);
		return true;
	}
}));
