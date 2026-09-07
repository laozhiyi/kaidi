const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

const TYPE_DESC = {
	bug: '功能异常',
	suggest: '功能建议',
	complain: '投诉举报',
	other: '其他'
};

const STATUS_DESC = {
	0: { label: '待处理', color: '#397bc8', bgColor: 'rgba(57, 123, 200, .12)' },
	1: { label: '已处理', color: '#2dc87a', bgColor: 'rgba(45, 200, 122, .12)' },
	2: { label: '已忽略', color: '#94a3b8', bgColor: 'rgba(148, 163, 184, .14)' }
};

Page({
	data: {
		id: '',
		detail: null,
		isLoad: false
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		if (!options || !options.id) {
			pageHelper.showModal('参数错误', '温馨提示');
			return;
		}
		this.setData({ id: options.id });
		await this._loadDetail();
	},

	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	_loadDetail: async function () {
		let opts = { title: 'bar' };
		let detail = await cloudHelper.callCloudData('feedback/my_detail', { id: this.data.id }, opts);
		if (detail) {
			detail._typeDesc = TYPE_DESC[detail.FB_TYPE] || '其他';
			detail._statusDesc = STATUS_DESC[detail.FB_STATUS] || STATUS_DESC[0];
		}
		this.setData({ detail, isLoad: true });
	},

	// 预览图片
	bindPreviewImage: function (e) {
		let url = pageHelper.dataset(e, 'url');
		if (!this.data.detail || !this.data.detail.FB_IMG_PREVIEW) return;
		wx.previewImage({
			urls: this.data.detail.FB_IMG_PREVIEW,
			current: url
		});
	},

	onShareAppMessage: function () { }
})
