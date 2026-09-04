const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

// 服务下拉选项：目前只接入「快递代取」
const SERVICE_OPTIONS = [
	{ label: '快递代取', val: 'mail' },
];

// 地点下拉选项
const LOCATION_OPTIONS = [
	'一期宿舍',
	'二期宿舍',
	'三期宿舍',
	'四期宿舍',
	'五期宿舍',
];

// 服务 -> 云函数 list 与详情页
const SERVICE_MAP = {
	mail: { name: 'mail', label: '快递代取', list: 'mail/list', detailBase: '../../mail/detail/mail_detail' },
};

Page({
	data: {
		isLoad: false,
		type: 'all', // all | post | accept

		// 二级下拉
		serviceOptions: SERVICE_OPTIONS,
		service: 'mail',
		locationOptions: LOCATION_OPTIONS,
		location: '',

		dataList: [],
		loading: false,
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		this.setData({ isLoad: true });
		await this._loadList();
	},

	onShow: async function () {
		if (this.data.isLoad) await this._loadList();
	},

	onPullDownRefresh: async function () {
		await this._loadList();
		wx.stopPullDownRefresh();
	},

	bindTypeTap: async function (e) {
		const type = pageHelper.dataset(e, 'type');
		if (type === this.data.type) return;
		this.setData({ type, dataList: [] });
		await this._loadList();
	},

	bindServiceSelect: async function (e) {
		const val = (e && e.detail !== undefined) ? e.detail : e;
		this.setData({ service: val, dataList: [] });
		await this._loadList();
	},

	bindLocationSelect: async function (e) {
		const val = (e && e.detail !== undefined) ? e.detail : e;
		this.setData({ location: val, dataList: [] });
		await this._loadList();
	},

	bindOrderTap: function (e) {
		const url = pageHelper.dataset(e, 'url');
		if (!url) return;
		wx.navigateTo({ url });
	},

	_loadList: async function () {
		if (this.data.loading) return;
		this.setData({ loading: true });

		const { type, service, location } = this.data;
		const c = SERVICE_MAP[service];
		if (!c) {
			this.setData({ dataList: [], loading: false });
			return;
		}

		const collected = [];
		try {
			const params = {
				page: 1,
				size: 50,
				isTotal: false,
				sortType: 'status',
				sortVal: 0, // 默认只看"待接单"以保证是当前用户相关的订单；如需全部可调整
			};
			const res = await cloudHelper.callCloudSumbit(c.list, params, { title: 'bar' });
			const list = (res && res.data && res.data.list) || [];
			list.forEach(it => {
				if (type === 'post' && !it.mypost) return;
				if (type === 'accept' && !it.myaccept) return;
				if (type === 'all' && !it.mypost && !it.myaccept) return;
				collected.push(this._formatItem(it, c));
			});
		} catch (err) {
			console.warn('订单加载失败', service, err);
		}

		// 地点筛选（客户端按取/送地址子串匹配）
		let filtered = collected;
		if (location) {
			filtered = collected.filter(it => {
				return (it.from && it.from.indexOf(location) !== -1)
					|| (it.to && it.to.indexOf(location) !== -1);
			});
		}

		filtered.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));

		this.setData({ dataList: filtered, loading: false });
	},

	_formatItem: function (it, c) {
		const obj = it.MAIL_OBJ || {};
		const statusMap = {
			'0': { key: 'wait', label: '待接单' },
			'1': { key: 'accepted', label: '已接单' },
			'9': { key: 'done', label: '已完成' },
			'99': { key: 'cancel', label: '已取消' },
		};
		const s = statusMap[it.status] || { key: 'default', label: it.status || '处理中' };
		const role = it.mypost ? '我发布的' : (it.myaccept ? '我接的' : '');

		return {
			id: it._id,
			typeLabel: c.label,
			roleLabel: role,
			statusKey: s.key,
			statusLabel: s.label,
			title: obj.title || obj.address1 || '(无标题)',
			from: obj.address1 || '-',
			to: obj.address2 || '-',
			time: it.MAIL_ADD_TIME || '',
			price: obj.price || 0,
			timeStamp: 0,
			url: c.detailBase + '?id=' + it._id,
		};
	},

	url: async function (e) {
		pageHelper.url(e, this);
	},

	onShareAppMessage: function () {},
});
