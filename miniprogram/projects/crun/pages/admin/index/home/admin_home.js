const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	/**
	 * 页面的初始数据
	 */
	data: { chartData: [], healthChartData: [], dashboard: null },

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		this._loadDetail();
	},

	/**
	 * 页面相关事件处理函数--监听用户下拉动作
	 */
	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	_loadDetail: async function () {

		let admin = AdminBiz.getAdminToken();
		this.setData({
			isLoad: true,
			admin
		});

		try {
			let opts = {
				title: 'bar'
			}
			let res = await cloudHelper.callCloudData('admin/home', {}, opts);
			this.setData({ stat: res });
			try {
				const overview = await cloudHelper.callCloudData('admin/operations_overview', {}, opts);
				const total = Number(overview.total || 0);
				const rows = [
					{ label: '待接单', value: Number(overview.waiting || 0), color: '#5c9bea' },
					{ label: '配送中', value: Number(overview.delivering || 0), color: '#33a184' },
					{ label: '待收货', value: Number(overview.confirming || 0), color: '#d99a42' },
					{ label: '异常', value: Number(overview.exceptions || 0), color: '#df6d6d' },
					{ label: '已完成', value: Number(overview.completed || 0), color: '#6fa36d' },
				];
				const healthTotal = Math.max(1, Number(overview.complaints || 0) + Number(overview.failedNotifications || 0) + Number(overview.exceptions || 0) + Number(overview.confirming || 0));
				const healthRows = [
					{ label: '异常订单', value: Number(overview.exceptions || 0), color: '#df6d6d' },
					{ label: '待处理投诉', value: Number(overview.complaints || 0), color: '#d99a42' },
					{ label: '通知失败', value: Number(overview.failedNotifications || 0), color: '#9d7ed0' },
					{ label: '待收货', value: Number(overview.confirming || 0), color: '#5c9bea' },
				];
				this.setData({ dashboard: overview, chartData: rows.map(item => Object.assign(item, { percent: total && item.value ? Math.max(4, Math.round(item.value / total * 100)) : 0 })), healthChartData: healthRows.map(item => Object.assign(item, { percent: item.value ? Math.max(4, Math.round(item.value / healthTotal * 100)) : 0 })) });
			} catch (e) { console.warn('[admin] overview unavailable', e); }

		} catch (err) {
			console.log(err);
		}
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () {

	},

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () { if (this.data.isLoad && AdminBiz.isAdmin(this)) this._loadDetail(); },

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

	url: function (e) {
		pageHelper.url(e, this);
	},

	bindMoreTap: function (e) {
		let itemList = ['取消所有首页推荐'];
		wx.showActionSheet({
			itemList,
			success: async res => {
				let idx = res.tapIndex;

				if (idx == 0) {
					this._clearVouch();
				}

			},
			fail: function (res) { }
		})
	},

	_clearVouch: async function (e) {
		let cb = async () => {
			try {
				await cloudHelper.callCloudSumbit('admin/clear_vouch').then(res => {
					pageHelper.showSuccToast('操作成功');
				})
			} catch (err) {
				console.log(err);
			}
		};
		pageHelper.showConfirm('您确认清除所有首页推荐？', cb)
	},

	bindExitTap: function (e) {

		let callback = function () {
			AdminBiz.clearAdminToken();
			wx.reLaunch({
				url: pageHelper.fmtURLByPID('/pages/my/index/my_index'),
			});
		}
		pageHelper.showConfirm('您确认退出?', callback);
	}, 

})
