const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	data: {
		isLoad: false,
		type: 'all', // all | post | accept
		status: '',
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

	bindStatusTap: async function (e) {
		const status = String(pageHelper.dataset(e, 'status'));
		this.setData({ status, dataList: [] });
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

		const { type, status } = this.data;

		// 各业务模块的 list 接口都按 sortType/status 服务端过滤，
		// 这里通过各 list 返回 mypost/myaccept 标志 + sortType='status' 把"我的"过滤交给后端
		const calls = [
			{ name: 'mail', label: '快递代取', list: 'mail/list', detailBase: '../../mail/detail/mail_detail' },
			{ name: 'thing', label: '急事代办', list: 'thing/list', detailBase: '../../thing/detail/thing_detail' },
			{ name: 'food', label: '代买', list: 'food/list', detailBase: '../../food/detail/food_detail' },
			{ name: 'follow', label: '陪替', list: 'follow/list', detailBase: '../../follow/detail/follow_detail' },
		];

		const collected = [];
		await Promise.all(calls.map(async c => {
			try {
				const params = {
					page: 1,
					size: 30,
					isTotal: false,
				};
				if (status !== '') {
					// 'status' 模式后端仅返回与当前用户相关
					params.sortType = 'status';
					params.sortVal = status;
				}

				const res = await cloudHelper.callCloudSumbit(c.list, params, { title: 'bar' });
				const list = (res && res.data && res.data.list) || [];
				list.forEach(it => {
					if (type === 'post' && !it.mypost) return;
					if (type === 'accept' && !it.myaccept) return;
					if (type === 'all' && !it.mypost && !it.myaccept) return;
					collected.push(this._formatItem(it, c));
				});
			} catch (err) {
				console.warn('订单加载失败', c.name, err);
			}
		}));

		collected.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));

		this.setData({ dataList: collected, loading: false });
	},

	_formatItem: function (it, c) {
		const obj = it.MAIL_OBJ || it.THING_OBJ || it.FOOD_OBJ || it.FOLLOW_OBJ || {};
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
			time: it.MAIL_ADD_TIME || it.THING_ADD_TIME || it.FOOD_ADD_TIME || it.FOLLOW_ADD_TIME || '',
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
