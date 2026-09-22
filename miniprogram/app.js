const setting = require('./setting/setting.js');
const InviteBiz = require('./projects/crun/biz/invite_biz.js');
const Notifications = require('./projects/crun/biz/notification_biz.js');
const OrderSync = require('./projects/crun/biz/order_sync_biz.js');

App({
	onShow: function (options = {}) {
		const code = options.query && options.query.inviteCode;
		if (code) InviteBiz.capture(code);
		Notifications.resume();
		OrderSync.resume();
	},
	onHide() { Notifications.pause(); OrderSync.pause(); },
	onLaunch: function (options) {

		if (!wx.cloud) {
			console.error('请使用 2.2.3 或以上的基础库以使用云能力')
		} else {
			wx.cloud.init({
				// env 参数说明：
				//   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
				//   此处请填入环境 ID, 环境 ID 可打开云控制台查看
				//   如不填则使用默认环境（第一个创建的环境）
				// env: 'my-env-id',
				env: setting.CLOUD_ID,
				traceUser: true,
			})
		}

		this.globalData = {};

		// 用于自定义导航栏
		const setNavigationMetrics = info => {
			this.globalData.statusBarHeight = info.statusBarHeight;
			const capsule = wx.getMenuButtonBoundingClientRect();
			if (capsule) {
				this.globalData.customBarHeight = capsule.bottom + capsule.top - info.statusBarHeight;
				this.globalData.capsule = capsule;
			} else {
				this.globalData.customBarHeight = info.statusBarHeight + 50;
			}
		};
		if (typeof wx.getWindowInfo === 'function') setNavigationMetrics(wx.getWindowInfo());
		else wx.getSystemInfo({ success: setNavigationMetrics });
	}, 
	 
})
