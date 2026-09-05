/**
 * Notes: 路由配置文件
  * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * User: CC
 * Date: 2020-10-14 07:00:00
 */

module.exports = {
	'home/setup_get': 'home_controller@getSetup',

	'passport/login': 'passport_controller@login',
	'passport/phone': 'passport_controller@getPhone',
	'passport/my_detail': 'passport_controller@getMyDetail',
	'passport/register': 'passport_controller@register',
	'passport/edit_base': 'passport_controller@editBase',
	'check/img': 'check_controller@checkImg',

	// 收藏
	'fav/update': 'fav_controller@updateFav',
	'fav/del': 'fav_controller@delFav',
	'fav/is_fav': 'fav_controller@isFav',
	'fav/my_list': 'fav_controller@getMyFavList',

	'admin/home': 'admin/admin_home_controller@adminHome',
	'admin/clear_vouch': 'admin/admin_home_controller@clearVouchData',

	'admin/login': 'admin/admin_mgr_controller@adminLogin',
	'admin/mgr_list': 'admin/admin_mgr_controller@getMgrList',
	'admin/mgr_insert': 'admin/admin_mgr_controller@insertMgr#demo',
	'admin/mgr_del': 'admin/admin_mgr_controller@delMgr#demo',
	'admin/mgr_detail': 'admin/admin_mgr_controller@getMgrDetail',
	'admin/mgr_edit': 'admin/admin_mgr_controller@editMgr#demo',
	'admin/mgr_status': 'admin/admin_mgr_controller@statusMgr#demo',
	'admin/mgr_pwd': 'admin/admin_mgr_controller@pwdMgr#demo',
	'admin/log_list': 'admin/admin_mgr_controller@getLogList',
	'admin/log_clear': 'admin/admin_mgr_controller@clearLog#demo',

	'admin/setup_set': 'admin/admin_setup_controller@setSetup#demo',
	'admin/setup_set_content': 'admin/admin_setup_controller@setContentSetup#demo',
	'admin/setup_qr': 'admin/admin_setup_controller@genMiniQr',

	// 用户
	'admin/user_list': 'admin/admin_user_controller@getUserList',
	'admin/user_detail': 'admin/admin_user_controller@getUserDetail',
	'admin/user_del': 'admin/admin_user_controller@delUser#demo',
	'admin/user_status': 'admin/admin_user_controller@statusUser#demo',

	'admin/user_data_get': 'admin/admin_user_controller@userDataGet',
	'admin/user_data_export': 'admin/admin_user_controller@userDataExport',
	'admin/user_data_del': 'admin/admin_user_controller@userDataDel',


	// 内容  
	'home/list': 'home_controller@getHomeList',
	'news/list': 'news_controller@getNewsList',
	'news/view': 'news_controller@viewNews',

	'admin/news_list': 'admin/admin_news_controller@getAdminNewsList',
	'admin/news_insert': 'admin/admin_news_controller@insertNews#demo',
	'admin/news_detail': 'admin/admin_news_controller@getNewsDetail',
	'admin/news_edit': 'admin/admin_news_controller@editNews#demo',
	'admin/news_update_forms': 'admin/admin_news_controller@updateNewsForms#demo',
	'admin/news_update_pic': 'admin/admin_news_controller@updateNewsPic#demo',
	'admin/news_update_content': 'admin/admin_news_controller@updateNewsContent#demo',
	'admin/news_del': 'admin/admin_news_controller@delNews#demo',
	'admin/news_sort': 'admin/admin_news_controller@sortNews#demo',
	'admin/news_status': 'admin/admin_news_controller@statusNews#demo',



	// 快递代取
	'mail/list': 'mail_controller@getMailList',
	'mail/insert': 'mail_controller@insertMail',
	'mail/edit': 'mail_controller@editMail',
	'mail/status': 'mail_controller@statusMail',
	'mail/update_forms': 'mail_controller@updateMailForms',
	'mail/del': 'mail_controller@delMail',
	'mail/view': 'mail_controller@viewMail',
	'mail/accept': 'mail_controller@acceptMail',
	'mail/cancel': 'mail_controller@cancelMail',
	'mail/finish': 'mail_controller@finishMail',
	'mail/detail': 'mail_controller@getMailDetail',

	'admin/mail_detail': 'admin/admin_mail_controller@getAdminMailDetail',
	'admin/mail_list': 'admin/admin_mail_controller@getAdminMailList',
	'admin/mail_status': 'admin/admin_mail_controller@statusMail#demo',
	'admin/mail_del': 'admin/admin_mail_controller@delMail#demo',
	'admin/mail_sort': 'admin/admin_mail_controller@sortMail#demo',
	'admin/mail_data_get': 'admin/admin_mail_controller@mailDataGet',
	'admin/mail_data_export': 'admin/admin_mail_controller@mailDataExport',
	'admin/mail_data_del': 'admin/admin_mail_controller@mailDataDel',

	// 急事代办


	// 外卖代取


	// 陪替服务


	// ========== 支付模块 ==========
	'pay/create': 'pay_controller@createPay',
	'pay/query': 'pay_controller@queryPay',
	'pay/refund': 'pay_controller@refund',

}
