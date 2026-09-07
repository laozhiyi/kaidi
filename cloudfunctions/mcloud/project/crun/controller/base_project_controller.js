/**
 * Notes: 本业务基本控制器
 * Date: 2021-03-15 19:20:00 
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 */

const BaseController = require('../../../framework/platform/controller/base_controller.js');
const BaseProjectService = require('../service/base_project_service.js');

class BaseProjectController extends BaseController {

	// TODO
	async initSetup() {
		let service = new BaseProjectService();
		await service.initSetup();
  const publicRoutes = ['passport/login','passport/register','passport/phone','passport/my_detail','passport/edit_base','home/setup_get','home/list','news/list','news/view','mail/view','mail/list','operations/config','campus_service/list','campus_service/detail','check/img'];
  if(!publicRoutes.includes(this._route)) await new (require('../service/mail_service.js'))()._user(this._userId);
	}
}

module.exports = BaseProjectController;