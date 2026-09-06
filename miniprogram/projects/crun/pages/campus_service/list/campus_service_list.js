const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	data: {
		list: [],
		isLoad: false
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		await this._loadList();
	},

	onShow: async function () {
		if (this.data.isLoad) await this._loadList();
	},

	onPullDownRefresh: async function () {
		await this._loadList();
		wx.stopPullDownRefresh();
	},

	_loadList: async function () {
		let opts = { title: 'bar' };
		let res = await cloudHelper.callCloudData('campus_service/list', { page: 1, size: 50 }, opts);
		if (res && Array.isArray(res.list)) {
			this.setData({ list: res.list, isLoad: true });
		} else {
			this.setData({ list: [], isLoad: true });
		}
	},

	// 拨打电话
	bindCallTap: function (e) {
		let mobile = pageHelper.dataset(e, 'mobile');
		if (!mobile) {
			wx.showToast({ title: '暂未提供电话', icon: 'none' });
			return;
		}
		wx.makePhoneCall({ phoneNumber: mobile, fail: () => { } });
	},

	// 复制微信号
	bindCopyWechat: function (e) {
		let wechat = pageHelper.dataset(e, 'wechat');
		if (!wechat) {
			wx.showToast({ title: '暂未提供微信', icon: 'none' });
			return;
		}
		wx.setClipboardData({
			data: wechat,
			success: () => {
				wx.showToast({ title: '已复制微信号', icon: 'success' });
			}
		});
	},

	// 复制QQ号
	bindCopyQQ: function (e) {
		let qq = pageHelper.dataset(e, 'qq');
		if (!qq) {
			wx.showToast({ title: '暂未提供QQ', icon: 'none' });
			return;
		}
		wx.setClipboardData({
			data: qq,
			success: () => {
				wx.showToast({ title: '已复制QQ号', icon: 'success' });
			}
		});
	},

	onShareAppMessage: function () { }
})
