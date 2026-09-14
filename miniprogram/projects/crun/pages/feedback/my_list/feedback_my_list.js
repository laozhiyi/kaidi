const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

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
		this._visible = true;
		if (await PassportBiz.loginMustBackWin(this) && this._visible) await this._loadList(true);
	},
	onHide: function () { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
	onUnload: function () { this.onHide(); },

	onPullDownRefresh: async function () {
		try { await this._loadList(); } finally { wx.stopPullDownRefresh(); }
	},

	_loadList: async function (reset = true) {
 if (typeof reset !== 'boolean') reset = true;
 if (!this._visible || !reset && this.data.loading) return;
 const seq = this._seq = (this._seq || 0) + 1;
 this.setData({loading:true,error:false});
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
		if(!res || !Array.isArray(res.list))throw new Error('加载失败');
 if (this._visible && seq === this._seq) this.setData({ list:reset?list:this.data.list.concat(list),isLoad:true,page,hasMore:!!res.hasMore });
 } catch(e){if (this._visible && seq === this._seq) this.setData({error:true,isLoad:true});}finally{if (this._visible && seq === this._seq) this.setData({loading:false});}
	},

 bindMore: function(){if(this.data.hasMore)this._loadList(false);},
 onReachBottom: function(){this.bindMore();},
	bindItemTap: function (e) {
		let id = pageHelper.dataset(e, 'id');
		wx.navigateTo({
			url: '../detail/feedback_detail?id=' + encodeURIComponent(id)
		});
	},

	bindAddTap: function () {
		wx.navigateTo({
			url: '../index/feedback_index'
		});
	},

	onShareAppMessage: function () { }
})
