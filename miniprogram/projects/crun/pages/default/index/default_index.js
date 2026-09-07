const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false,
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);

	},

	setDM: function (data) {
		// 处理弹幕参数
		const dmArr = [];
		for (let i = 0; i < data.length; i++) {
			let time = Math.floor(Math.random() * 10);
			let second = Math.floor(Math.random() * 60);
			let _time = time < 6 ? 6 + i : time + i;
			let top = Math.floor(Math.random() * 80) + 2;
			let node = {
				title: data[i].title,
				top,
				second,
				time: _time,
			};
			dmArr.push(node);
		}
		this.setData({
			dmData: dmArr
		});
	},

	_loadList: async function () {
		let opts = {
			title: 'bar'
		}
		try {
			let res = await cloudHelper.callCloudSumbit('home/list', {}, opts);
			if (!res || !res.data) res = { data: { list: [], cnt: 0 } };
			if (typeof res.data.cnt === 'undefined') res.data.cnt = (res.data.list || []).length;
			this.setData({
				...res.data
			}, () => {
				this.setData({ isLoad: true });
				if (res.data.list && res.data.list.length) this.setDM(res.data.list);
			});
		} catch (err) {
			console.error('加载首页列表失败', err);
			this.setData({ isLoad: true, cnt: 0 });
		}
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () { },

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: async function () {
		const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
		if (tabBar) tabBar.setData({ selected: 0 });
		this._loadList();
	},

	onPullDownRefresh: async function () {
		await this._loadList();
		wx.stopPullDownRefresh();
	},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {

	},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {

	},

	handleFeatureTap: function (e) {
		const url = e.currentTarget.dataset.url;
		if (url) {
			this.url(e);
			return;
		}
		wx.showToast({
			title: '该功能暂未开放',
			icon: 'none',
			duration: 2000
		});
	},

	url: async function (e) {
		pageHelper.url(e, this);
	},


	bindCurTap: function (e) {
		let cur = pageHelper.dataset(e, 'cur');
		this.setData({ cur });
	},

	/**
	 * 快递代取入口：先选择发布订单或接单
	 */
	bindExpressTap: function () {
		wx.navigateTo({
			url: pageHelper.fmtURLByPID('/pages/mail/choose/mail_choose')
		});
	},

	/**
	 * 用户点击右上角分享
	 */
	onShareAppMessage: function () {

	},
})
