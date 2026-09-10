const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');  
const cacheHelper = require('../../../../../../helper/cache_helper.js');

Page({

	/**
	 * 页面的初始数据
	 */
	data: {
		name: 'admin',
		pwd: '123456',
		remember: false
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: function (options) {
		AdminBiz.clearAdminToken();

		// 清理旧版本保存的明文密码，只保留登录会话。
		cacheHelper.remove('admin-pwd');
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () {

	},

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () {},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {this.setData({pwd:''});},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {

	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	bindBackTap: function (e) {
		wx.reLaunch({
			url: pageHelper.fmtURLByPID('/pages/my/index/my_index'),
		});
	},

	bindLoginTap: async function (e) {
		if(this._loggingIn)return;this._loggingIn=true;
		try{return await AdminBiz.adminLogin(this,this.data.name,this.data.pwd);}finally{this._loggingIn=false;this.setData({pwd:''});}
	},

	bindRememberTap: function (e) {
		this.setData({
			remember: !this.data.remember
		})
	}

})