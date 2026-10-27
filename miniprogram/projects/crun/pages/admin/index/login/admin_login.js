const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');  
const cacheHelper = require('../../../../../../helper/cache_helper.js');

Page({

	/**
	 * 页面的初始数据
	 */
	data: {
		name: '',
		pwd: '',
		remember: false,
		loggingIn: false,
		passwordLogin: false
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
		this._unloaded = true;
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	bindBackTap: function (e) {
		wx.reLaunch({
			url: pageHelper.fmtURLByPID('/pages/my/index/my_index'),
		});
	},

	/** 微信登录：后台权限由超级管理员在用户管理中授权 */
	bindWechatLogin: async function (e) {
		if (this._loggingIn) return;
		this._loggingIn = true;
		this.setData({ loggingIn: true });
		try { return await AdminBiz.wechatLogin(this); }
		finally { this._loggingIn = false; if (!this._unloaded) this.setData({ loggingIn: false, pwd: '' }); }
	},

	bindTogglePassword: function (e) {
		if (this._loggingIn) return;
		this.setData({ passwordLogin: !this.data.passwordLogin, pwd: '' });
	},

	bindLoginTap: async function (e) {
		if(this._loggingIn)return;this._loggingIn=true;this.setData({loggingIn:true});
		try{return await AdminBiz.adminLogin(this,this.data.name,this.data.pwd);}finally{this._loggingIn=false;this.setData({pwd:'',loggingIn:false});}
	},

	bindRememberTap: function (e) {
		this.setData({
			remember: !this.data.remember
		})
	}

})
