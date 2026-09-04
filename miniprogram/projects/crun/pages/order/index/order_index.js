let behavior = require('../../../biz/project_index_bh.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');

Page({

	behaviors: [behavior],

	/**
	 * 页面的初始数据
	 */
	data: {
		type: 'order',
		curTab: 'all', // 当前订单类型: all-全部, wait-待接单, done-已完成
		curServiceType: '', // 当前服务类型: ''-全部, mail-快递, thing-代办
		curLocation: '', // 当前地点筛选
		curTabIndex: 0,
		curServiceTypeIndex: 0,
		curLocationIndex: 0,

		filterShow: false,
		filterType: '',

		orderTypeOptions: [
			{ label: '全部订单', val: 'all', sortType: 'all', sortVal: '' },
			{ label: '待接单', val: 'wait', sortType: 'wait', sortVal: 'wait' },
			{ label: '已完成', val: 'done', sortType: 'status', sortVal: '9' }
		],
		serviceTypeOptions: [
			{ label: '全部服务', val: '' },
			{ label: '快递代取', val: 'mail' },
			{ label: '急事代办', val: 'thing' }
		],
		locationOptions: [
			{ label: '全部地点', val: '' },
			{ label: '校园内', val: 'campus' },
			{ label: '校外', val: 'offcampus' }
		],

		dataList: {
			list: [],
			loading: false,
			hasMore: true
		},
		refresherTriggered: false,
		isLoad: false,

		dropdownLeft: 24, // 下拉弹层 left (px)
		dropdownTop: 0, // 下拉弹层 top (px)
		dropdownWidth: 0, // 下拉弹层 width (px)
	},

	/**
	 * 初始化搜索菜单 - 由 behavior:_onLoad 调用
	 */
	_getSearchMenu: function () {
		this.setData({
			_params: {
				sortType: 'all',
				sortVal: ''
			},
			sortMenus: [
				{ label: '全部', type: 'all', value: '' }
			],
			sortItems: []
		});
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: function (options) {
		this._onLoad(options);
		this.setData({ isLoad: true });
		this._getList(1);
	},

	onShow: function () {
		wx.setNavigationBarTitle({ title: '订单中心' });
		if (this.data.isLoad) {
			this._getList(1);
		}
	},

	onPullDownRefresh: function () {
		this._getList(1, () => {
			wx.stopPullDownRefresh();
		});
	},

	onReachBottom: function () {
		if (this.data.dataList.loading || !this.data.dataList.hasMore) return;
		this._getList(this.data.dataList.page + 1);
	},

	/**
	 * 获取订单列表 - 合并 mail/list 和 thing/list
	 */
	_getList: async function (page, callback) {
		this.setData({ 'dataList.loading': true });

		const orderOpt = this.data.orderTypeOptions[this.data.curTabIndex];
		const sortType = orderOpt.sortType;
		const sortVal = orderOpt.sortVal;
		const serviceType = this.data.curServiceType;

		// 根据服务类型筛选决定要调用哪些云函数
		const calls = [];
		if (!serviceType || serviceType === 'mail') {
			calls.push(this._fetchByType('mail', page, sortType, sortVal));
		}
		if (!serviceType || serviceType === 'thing') {
			calls.push(this._fetchByType('thing', page, sortType, sortVal));
		}

		try {
			const results = await Promise.all(calls);
			let merged = [];
			let hasMore = false;
			results.forEach(r => {
				if (r && r.list) {
					merged = merged.concat(r.list);
					if (r.hasMore) hasMore = true;
				}
			});

			// 按时间倒序
			merged.sort((a, b) => {
				const ta = new Date(a.timeAgoStr || 0).getTime();
				const tb = new Date(b.timeAgoStr || 0).getTime();
				return tb - ta;
			});

			// 补充显示字段
			merged.forEach(item => {
				item.timeAgo = this._formatTimeAgo(item.timeAgoStr);
				item.title = item.title || (item.type === 'mail' ? '代取快递' : '急事代办');
				item.price = item.price || 0;
			});

			if (page === 1) {
				this.setData({
					'dataList.list': merged,
					'dataList.page': page,
					'dataList.hasMore': hasMore,
					'dataList.loading': false
				});
			} else {
				this.setData({
					'dataList.list': [...this.data.dataList.list, ...merged],
					'dataList.page': page,
					'dataList.hasMore': hasMore,
					'dataList.loading': false
				});
			}

			if (callback) callback();
		} catch (e) {
			console.error('订单列表加载失败', e);
			if (page === 1) {
				this.setData({
					'dataList.list': [],
					'dataList.page': page,
					'dataList.hasMore': false,
					'dataList.loading': false
				});
			} else {
				this.setData({
					'dataList.loading': false,
					'dataList.hasMore': false
				});
			}
			if (callback) callback();
		}
	},

	/**
	 * 调用指定类型的列表云函数并归一化字段
	 */
	_fetchByType: async function (type, page, sortType, sortVal) {
		const params = {
			page: page,
			size: 10,
			sortType: sortType || 'all',
			sortVal: sortVal || '',
			isTotal: false
		};

		try {
			const res = await cloudHelper.callCloudSumbit(type + '/list', params, { title: '', hint: false });
			const list = (res && res.data && res.data.list) ? res.data.list : [];
			const normalized = list.map(it => this._normalizeItem(it, type));
			return {
				list: normalized,
				hasMore: list.length >= 10
			};
		} catch (e) {
			console.error(type + '/list 加载失败', e);
			return { list: [], hasMore: false };
		}
	},

	/**
	 * 将 mail 或 thing 列表项归一化为统一字段
	 * 统一输出: _id, type, status, title, price, address1, address2, remark, timeAgoStr
	 */
	_normalizeItem: function (it, type) {
		const OBJ = type === 'mail' ? it.MAIL_OBJ : it.THING_OBJ;
		const TIME_FIELD = type === 'mail' ? 'MAIL_ADD_TIME' : 'THING_ADD_TIME';
		const STATUS_FIELD = type === 'mail' ? 'MAIL_STATUS' : 'THING_STATUS';
		const END_FIELD = type === 'mail' ? 'MAIL_END_TIME' : 'THING_END_TIME';
		const rawStatus = Number(it[STATUS_FIELD]);
		let status = it.status;
		if (!status) {
			if (rawStatus === 0 && Number(it[END_FIELD]) > 0 && Number(it[END_FIELD]) < Date.now()) status = '已过期';
			else if (rawStatus === 3 || rawStatus === 9) status = '已完成';
			else if (rawStatus === 99) status = '已取消';
			else if (rawStatus === 1 || rawStatus === 2) status = '已接单';
			else status = '待接单';
		}
		const addTime = it[TIME_FIELD] || '';
		return {
			_id: it._id,
			type: type,
			status: status,
			typeLabel: type === 'mail' ? '快递代取' : '急事代办',
			title: OBJ ? (OBJ.title || (type === 'mail' ? '代取快递' : '急事代办')) : '',
			price: OBJ ? (OBJ.price || 0) : 0,
			quantity: OBJ && type === 'mail' ? (Number(OBJ.num) || 1) : 1,
			poster: OBJ ? (OBJ.poster || '') : '',
			userPic: it.user ? (it.user.USER_PIC || '') : '',
			address1: OBJ ? (OBJ.address1 || '') : '',
			address2: OBJ ? (OBJ.address2 || '') : '',
			remark: OBJ ? (OBJ.desc || OBJ.remark || '') : '',
			endTime: it.end || '',
			timeAgoStr: addTime,
			timeText: addTime,
			myaccept: !!it.myaccept,
			mypost: !!it.mypost
		};
	},

	/**
	 * 格式化时间显示
	 */
	_formatTimeAgo: function (timestamp) {
		if (!timestamp) return '';
		let date;
		if (typeof timestamp === 'string') {
			date = new Date(timestamp.replace(/-/g, '/'));
		} else {
			date = new Date(timestamp);
		}
		if (isNaN(date.getTime())) return '';

		const now = Date.now();
		const diff = now - date.getTime();
		const minute = 60 * 1000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (diff < minute) {
			return '刚刚';
		} else if (diff < hour) {
			return Math.floor(diff / minute) + '分钟前';
		} else if (diff < day) {
			return Math.floor(diff / hour) + '小时前';
		} else if (diff < 7 * day) {
			return Math.floor(diff / day) + '天前';
		} else {
			return `${date.getMonth() + 1}-${date.getDate()}`;
		}
	},

	/**
	 * 点击筛选按钮 - 打开对应下拉（弹层精确定位到胶囊正下方）
	 */
	bindFilterTap: function (e) {
		const type = e.currentTarget.dataset.type;
		const newType = this.data.filterType === type ? '' : type;

		if (newType) {
			// 获取胶囊在视口中的位置，让下拉层紧贴其正下方
			const query = wx.createSelectorQuery();
			query.select('#filter-pill-' + type).boundingClientRect();
			query.exec(rects => {
				const rect = rects && rects[0];
				if (rect) {
					this.setData({
						filterShow: true,
						filterType: newType,
						dropdownLeft: rect.left,
						dropdownTop: rect.bottom + 8,
						dropdownWidth: rect.width
					});
				} else {
					this.setData({
						filterShow: true,
						filterType: newType,
						dropdownWidth: 0
					});
				}
			});
		} else {
			this.setData({
				filterShow: false,
				filterType: ''
			});
		}
	},

	/**
	 * 点击遮罩关闭下拉
	 */
	bindFilterMaskTap: function () {
		this.setData({ filterShow: false, filterType: '' });
	},

	/**
	 * 选择筛选选项
	 */
	bindFilterOptionTap: function (e) {
		const type = e.currentTarget.dataset.type;
		const idx = parseInt(e.currentTarget.dataset.index);

		if (type === 'orderType') {
			this.setData({
				curTabIndex: idx,
				curTab: this.data.orderTypeOptions[idx].val,
				filterShow: false,
				filterType: '',
				'dataList.list': [],
				'dataList.page': 0,
				'dataList.hasMore': true
			});
		} else if (type === 'serviceType') {
			this.setData({
				curServiceTypeIndex: idx,
				curServiceType: this.data.serviceTypeOptions[idx].val,
				filterShow: false,
				filterType: '',
				'dataList.list': [],
				'dataList.page': 0,
				'dataList.hasMore': true
			});
		} else if (type === 'location') {
			this.setData({
				curLocationIndex: idx,
				curLocation: this.data.locationOptions[idx].val,
				filterShow: false,
				filterType: '',
				'dataList.list': [],
				'dataList.page': 0,
				'dataList.hasMore': true
			});
		}

		this._getList(1);
	},

	bindPullDownRefresh: function () {
		this.setData({ refresherTriggered: true });
		this._getList(1, () => {
			this.setData({ refresherTriggered: false });
		});
	},

	bindReachBottom: function () {
		if (this.data.dataList.loading || !this.data.dataList.hasMore) return;
		this._getList(this.data.dataList.page + 1);
	},

	/**
	 * 接单操作
	 */
	bindAcceptTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		const type = e.currentTarget.dataset.type;

		wx.showModal({
			title: '确认接单',
			content: '确定要接下这个订单吗？',
			success: async res => {
				if (res.confirm) {
					try {
						await cloudHelper.callCloudSumbit(type + '/accept', { id }).then(res => {
							pageHelper.showSuccToast('接单成功');
							this._getList(1);
						});
					} catch (err) {
						pageHelper.showNoneToast('接单失败，请稍后再试');
					}
				}
			}
		});
	},

	/**
	 * 收藏操作
	 */
	bindFavTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		const type = e.currentTarget.dataset.type;
		try {
			await cloudHelper.callCloudSumbit('fav/update', { oid: id, type: type === 'mail' ? 'mail' : 'thing' }).then(res => {
				pageHelper.showSuccToast(res.data && res.data.isFav === 1 ? '收藏成功' : '已取消收藏');
			});
		} catch (err) {
			pageHelper.showNoneToast('收藏失败，请稍后再试');
		}
	},

})
