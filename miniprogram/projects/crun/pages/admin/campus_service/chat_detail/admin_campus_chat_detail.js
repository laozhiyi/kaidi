const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
const createChatPage = require('../../../campus_service/chat/chat_page.js');

const page = createChatPage({
  idKey: 'sessionId',
  getRoute: 'admin/campus_chat_detail',
  sendRoute: 'admin/campus_chat_reply',
  ownSender: 'admin',
  init(page) { return AdminBiz.isAdmin(page); }
});
page.bindBack = function () { UI.back('chats'); };
page.bindUserDetail = function () { if (this.data.userId) UI.go('user', { id: this.data.userId }); };
Page(page);
