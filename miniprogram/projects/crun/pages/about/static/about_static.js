const ProjectBiz = require('../../../biz/project_biz.js');

Page({

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);
	},

	onShareAppMessage: function () { }
})
