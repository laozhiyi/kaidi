const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	data: {
		isLoad: false,
		code: '',
		stat: { total: 0, accepted: 0, reward: 0, pending: 0 },
		list: []
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		await this._loadAll();
	},

	onShow: async function () {
		if (this.data.isLoad) await this._loadAll();
	},

	onPullDownRefresh: async function () {
		await this._loadAll();
		wx.stopPullDownRefresh();
	},

	_loadAll: async function () {
		let opts = { title: 'bar' };

		// 获取邀请码
		let codeRes = await cloudHelper.callCloudData('invite/my_code', {}, opts);
		// 获取统计
		let statRes = await cloudHelper.callCloudData('invite/my_stat', {}, opts);
		// 获取列表
		let listRes = await cloudHelper.callCloudData('invite/my_list', { page: 1, size: 20 }, opts);

		this.setData({
			code: codeRes && codeRes.code ? codeRes.code : '',
			stat: statRes || { total: 0, accepted: 0, reward: 0, pending: 0 },
			list: (listRes && listRes.list) || [],
			isLoad: true
		});
	},

	// 复制邀请码
	bindCopyCode: function () {
		if (!this.data.code) {
			wx.showToast({ title: '暂无邀请码', icon: 'none' });
			return;
		}
		wx.setClipboardData({
			data: this.data.code,
			success: () => {
				wx.showToast({ title: '已复制邀请码', icon: 'success' });
			}
		});
	},

	// 邀请好友（右上角分享）
	onShareAppMessage: function () {
		return {
			title: '校园跑腿，便捷互助，邀请你一起加入',
			path: '/projects/crun/pages/default/index/default_index?inviteCode=' + this.data.code,
			imageUrl: ''
		};
	},

	// 一键分享
	bindShareTap: function () {
		wx.showToast({ title: '点击右上角分享给好友', icon: 'none' });
	}
})
