const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

const CAMPUS_OPTIONS = [
	{ label: '全部校区', value: '' },
	{ label: '育才校区', value: '育才校区' },
	{ label: '王城校区', value: '王城校区' },
	{ label: '雁山校区', value: '雁山校区' }
];

function normalizeCampus(campus) {
	return String(campus || '').replace(/校区$/, '');
}

Page({
	data: {
		list: [],
		displayList: [],
		campusOptions: CAMPUS_OPTIONS,
		activeCampus: '',
		emptyText: '暂无校区客服，请稍后再试',
		isLoad: false
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
	},

	onShow: async function () {
		this._visible = true;
		await this._loadList();
	},

	onHide: function () { this._visible = false; },
	onUnload: function () { this._destroyed = true; },

	onPullDownRefresh: async function () {
		try { await this._loadList(); } finally { wx.stopPullDownRefresh(); }
	},

	bindRetryTap: function () { return this._loadList(); },

	_loadList: async function () {
		if (this._loading || !this._visible || this._destroyed) return;
		this._loading = true;
		try {
			let response = await cloudHelper.callCloud('campus_service/list', { page: 1, size: 100 }, { hint: false });
			let res = response && response.data;
			if (!res || !Array.isArray(res.list)) throw new Error('客服信息加载失败');
			let records = res.list;
			// 不只筛选第一页，确保排序靠后的校区客服也可见。
			for (let page = 2; page <= Number(res.count || 1); page++) {
				if (!this._visible || this._destroyed) return;
				const next = await cloudHelper.callCloud('campus_service/list', { page, size: 100 }, { hint: false });
				if (!next || !next.data || !Array.isArray(next.data.list)) throw new Error('客服信息加载失败');
				records = records.concat(next.data.list);
			}
			let list = records.filter(item => CAMPUS_OPTIONS.slice(1).some(option => normalizeCampus(option.value) === normalizeCampus(item.CS_CAMPUS)));
			list.sort((a, b) => this._campusRank(a.CS_CAMPUS) - this._campusRank(b.CS_CAMPUS));
			if (this._destroyed) return;
			this.setData({ list, isLoad: true, loadError: '' }, () => this._refreshDisplayList());
		} catch (err) {
			if (!this._destroyed) this.setData({ isLoad: true, loadError: '客服信息加载失败，点击重试' });
		} finally { this._loading = false; }
	},

	_campusRank: function (campus) {
		let name = normalizeCampus(campus);
		let index = CAMPUS_OPTIONS.findIndex(item => normalizeCampus(item.value) === name);
		return index < 0 ? CAMPUS_OPTIONS.length : index;
	},

	_refreshDisplayList: function () {
		let activeCampus = this.data.activeCampus;
		let displayList = this.data.list.filter(item => {
			return !activeCampus || normalizeCampus(item.CS_CAMPUS) === normalizeCampus(activeCampus);
		});
		let emptyText = activeCampus ? activeCampus + '暂无客服信息' : '暂无校区客服，请稍后再试';
		this.setData({ displayList, emptyText });
	},

	bindCampusTap: function (e) {
		let activeCampus = pageHelper.dataset(e, 'campus') || '';
		this.setData({ activeCampus }, () => this._refreshDisplayList());
	},

	// 进入对话
	bindChatTap: function (e) {
		let id = pageHelper.dataset(e, 'id');
		if (!id) return;
		wx.navigateTo({ url: '../chat/campus_service_chat?serviceId=' + encodeURIComponent(id) });
	},

	bindCallTap: function (e) {
		let mobile = pageHelper.dataset(e, 'mobile');
		if (!mobile) {
			wx.showToast({ title: '暂未提供电话', icon: 'none' });
			return;
		}
		wx.makePhoneCall({ phoneNumber: mobile, fail: () => { } });
	},

	// 复制微信号
	bindCopyWechat: function (e) {
		let wechat = pageHelper.dataset(e, 'wechat');
		if (!wechat) {
			wx.showToast({ title: '暂未提供微信', icon: 'none' });
			return;
		}
		wx.setClipboardData({
			data: wechat,
			success: () => {
				wx.showToast({ title: '已复制微信号', icon: 'success' });
			}
		});
	},

	// 复制QQ号
	bindCopyQQ: function (e) {
		let qq = pageHelper.dataset(e, 'qq');
		if (!qq) {
			wx.showToast({ title: '暂未提供QQ', icon: 'none' });
			return;
		}
		wx.setClipboardData({
			data: qq,
			success: () => {
				wx.showToast({ title: '已复制QQ号', icon: 'success' });
			}
		});
	},

	onShareAppMessage: function () { }
})
