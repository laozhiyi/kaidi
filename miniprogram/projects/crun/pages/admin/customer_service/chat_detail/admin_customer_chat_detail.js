const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
const createChatPage = require('../../../customer_service/chat/chat_page.js');

const page = createChatPage({
  idKey: 'sessionId',
  getRoute: 'admin/customer_service_chat',
  sendRoute: 'admin/customer_service_reply',
  ownSender: 'admin',
  init(page) { return AdminBiz.isAdmin(page); }
});
page.bindBack = function () { UI.back('chats'); };
page.bindUserDetail = function () { if (this.data.userId) UI.go('user', { id: this.data.userId }); };
page.bindOrderTap = function (e) { const id = e.currentTarget.dataset.id; if (id) UI.go('order', { id }); };
Page(page);
