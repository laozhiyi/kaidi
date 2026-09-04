Page({
	/**
	 * 选择快递代取的操作方向
	 */
	bindPublishTap: function () {
		wx.navigateTo({
			url: '/projects/crun/pages/mail/add/mail_add'
		});
	},

	bindAcceptTap: function () {
		wx.switchTab({
			url: '/projects/crun/pages/order/index/order_index'
		});
	},
});
