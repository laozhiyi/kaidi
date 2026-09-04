const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false,
		serviceItems: [
			{ title: '快递代取', icon: '../../../images/menu/mail.png', url: '../../mail/index/mail_index' },
			{ title: '校园跑腿', icon: '../../../images/follow/order.png', url: '../../follow/index/follow_index' },
			{ title: '快递代寄', icon: '../../../images/menu/mail.png', url: '../../mail/index/mail_index' },
			{ title: '代替服务', icon: '../../../images/menu/partner.png', url: '../../follow/index/follow_index' },
			{ title: '外卖代拿', icon: '../../../images/menu/food.png', url: '../../food/index/food_index' },
			{ title: '楼栋社群', icon: '../../../images/follow/seat.png', url: '../../follow/index/follow_index' },
		],
		foodCategories: [
			{ title: '名烟名酒', icon: '../../../images/menu/food.png', url: '../../food/index/food_index' },
			{ title: '饮品甜品', icon: '../../../images/menu/food.png', url: '../../food/index/food_index' },
			{ title: '看病买药', icon: '../../../images/follow/study.png', url: '../../follow/index/follow_index' },
			{ title: '超市打印', icon: '../../../images/menu/food.png', url: '../../food/index/food_index' },
		],
		merchantCategories: [
			{ title: '精选商家', icon: '../../../images/follow/game.png', url: '../../food/index/food_index' },
			{ title: '特惠商家', icon: '../../../images/menu/food.png', url: '../../food/index/food_index' },
			{ title: '爱心商家', icon: '../../../images/menu/partner.png', url: '../../food/index/food_index' },
			{ title: '连锁商家', icon: '../../../images/follow/bag.png', url: '../../food/index/food_index' },
		],
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
			this.setData({
				...res.data
			}, () => {
				this.setData({ isLoad: true });
				this.setDM(res.data.list);
			});
		} catch (err) {
			console.error('加载首页列表失败', err);
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
		const title = e.currentTarget.dataset.title;
		if (title === '快递代取') {
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
	 * 用户点击右上角分享
	 */
	onShareAppMessage: function () {

	},
})