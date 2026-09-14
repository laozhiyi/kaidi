let behavior = require('../../../../../comm/behavior/news_index_bh.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const NewsBiz = require('../../../biz/news_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');

Page({

	behaviors: [behavior], 
	data: { isLoggedIn: false },
	onShow() {
		this.setData({ isLoggedIn: Passport.isLogin() });
		const list = this.selectComponent('#news-list');
		if (list) list.reload();
	},

	onLoad: function (options) {
		ProjectBiz.initPage(this); 
		this._setCate(NewsBiz.getCateList(), options, null);  
	},


})
