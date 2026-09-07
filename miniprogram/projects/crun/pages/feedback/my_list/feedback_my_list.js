const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

const STATUS_DESC = {
	0: { label: '待处理', color: '#397bc8', bgColor: 'rgba(57, 123, 200, .12)' },
	1: { label: '已处理', color: '#2dc87a', bgColor: 'rgba(45, 200, 122, .12)' },
	2: { label: '不予处理', color: '#94a3b8', bgColor: 'rgba(148, 163, 184, .14)' }
};

Page({
	data: {
		list: [],
		isLoad: false, page:0, hasMore:false, loading:false, error:false
	},

	onLoad: function (options) {
		ProjectBiz.initPage(this);
	},

	onShow: async function () {
		await this._loadList(true);
	},

	onPullDownRefresh: async function () {
		await this._loadList();
		wx.stopPullDownRefresh();
	},

	_loadList: async function (reset = true) {
 if(this.data.loading)return;this.setData({loading:true,error:false});
 const page=reset?1:this.data.page+1;
 try {
		let opts = { title: 'bar' };
		let res = await cloudHelper.callCloudData('feedback/my_list', { page, size:20 }, opts);
		let list = [];
		if (res && Array.isArray(res.list)) {
			list = res.list.map(item => ({
				...item,
				// 提交反馈时 FB_TITLE 存的是投诉对象文本，直接作为卡片左上角标签
				_targetText: item.FB_TITLE || '其他',
				_statusDesc: STATUS_DESC[item.FB_STATUS] || STATUS_DESC[0]
			}));
		}
		if(!res)throw new Error('加载失败');
 this.setData({ list:reset?list:this.data.list.concat(list),isLoad:true,page,hasMore:!!res.hasMore });
 } catch(e){this.setData({error:true});}finally{this.setData({loading:false});}
	},

 bindMore: function(){if(this.data.hasMore)this._loadList(false);},
 onReachBottom: function(){this.bindMore();},
	bindItemTap: function (e) {
		let id = pageHelper.dataset(e, 'id');
		wx.navigateTo({
			url: '../detail/feedback_detail?id=' + id
		});
	},

	bindAddTap: function () {
		wx.navigateTo({
			url: '../index/feedback_index'
		});
	},

	onShareAppMessage: function () { }
})
