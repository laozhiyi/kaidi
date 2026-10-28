const Ops = require('../../../biz/operations_biz.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');
const Favorites = require('../../../biz/order_fav_biz.js');
const OrderSync = require('../../../biz/order_sync_biz.js');
const MailUI = require('../../../biz/mail_ui_biz.js');
const OrderFilter = require('../../../biz/order_filter_biz.js');

/**
 * 快递代取 - 接单/订单 Tab 页
 * 四个分段：
 *   0 可接单（浏览全部待接订单）    mail/list + sortType='wait'
 *   1 我接的（含取消与完成历史）        mail/list + search='我的接单' + sortType='status',sortVal='1'
 *   2 我发布的（全部状态）          mail/list + sortType='my_post'
 *   3 已完成                       mail/list + sortType='my_done'
 */
Page({
	data: {
		isLoad: false,
		tabIndex: 0,

		// 各 Tab 的查询参数，注入到 cmpt-comm-list 的 _params 中
		listParams: {
			take: { sortType: 'wait' },
			mine: { sortType: 'my_accept' },
			posted: { sortType: 'my_post' },
			done: { sortType: 'my_done' },
		},

		// 筛选状态：加急、价格排序与两个地点维度互相叠加；同一维度内多选取并集。
		filter: { price: false, urgent: false, deliver: [], deliverOther: false, pickup: [] },
		filterActive: false,
		deliverText: '',
		pickupText: '',
		// 地点筛选弹层（送达地点复用「所在地点」面板，取件地点用快递点/快递公司）
		locSheet: '',
		locGroups: [],
		locTall: false,
		locOther: false,
		locCount: 0,
		locSummary: '',

		// 列表数据（cmpt-comm-list 通过 bind:list 回填）
		dataList: null,
		favoriteBusyId: '', favoriteSyncError: false, acceptingId: '', actionBusyId: '', confirmingId: '', orderSyncError: false,
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		// 支持 ?tab=1/2 直接进入对应分段
		const tab = Number(options && options.tab);
		if (tab === 1 || tab === 2 || tab === 3) {
			this.setData({ tabIndex: tab });
		}
		if (tab === 1 || tab === 2 || tab === 3) wx.removeStorageSync('crun-order-tab');

		this.setData({ isLoad: true });
		// 送达地点与取件地点的候选都来自校区配置：地点表就是下单/添加地址用的那一套。
		// 配置到达前先用默认地点表渲染，不阻塞列表。
		this._refreshFilterSources();
		this._filterLoad = Ops.get('operations/config').then(config => {
			if (this._unloaded) return;
			this._configLocations = config && config.locations || {};
			this._refreshFilterSources();
		}).catch(() => { /* The order list remains usable without optional area filters. */ });

	},
	_refreshFilterSources: function () {
		if (!OrderFilter || typeof OrderFilter.buildSources !== 'function') return;
		this._filterSources = OrderFilter.buildSources({ locations: this._configLocations || {} });
	},

	onShow: function () {
		this._visible = true;
		const identity = PassportBiz.getUserId ? PassportBiz.getUserId() : '';
		if (this._dataListUser !== undefined && this._dataListUser !== identity) {
			this._tabSnapshots = new Map(); this.setData({ dataList: null });
		}
		if (this._stopOrderSync) this._stopOrderSync();
		this._stopOrderSync = OrderSync.subscribe(() => this._syncOrders());
		const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
		if (tabBar) tabBar.setData({ selected: 1 });
		const pendingTab = wx.getStorageSync('crun-order-tab');
		if (pendingTab !== '' && pendingTab !== null && pendingTab !== undefined) {
			wx.removeStorageSync('crun-order-tab');
			const idx = Number(pendingTab);
			if (idx >= 0 && idx <= 3 && idx !== this.data.tabIndex) {
				this.bindTabTap({ currentTarget: { dataset: { idx } } });
				return;
			}
		}
		this._startFavoriteSync();
		if (this._shownBefore) this._syncOrders();
		this._shownBefore = true;
	},
	onHide: function () { this._visible = false; this._stopFavoriteSync(); if (this._stopOrderSync) this._stopOrderSync(); this._stopOrderSync = null; },
	onUnload: function () { this._unloaded = true; this.onHide(); },
	_stopFavoriteSync: function () { if (this._favoriteWatcher) this._favoriteWatcher.stop(); this._favoriteWatcher = null; },
	_startFavoriteSync: function () {
		this._stopFavoriteSync();
		if (!this._visible || this.data.tabIndex !== 0) return;
		this._favoriteWatcher = Favorites.watch(
			() => (this.data.dataList && this.data.dataList.list || []).map(order => order._id),
			rows => this._applyFavoriteStats(rows),
			() => this.setData({ favoriteSyncError: true })
		);
		return this._favoriteWatcher.refresh();
	},
	_applyFavoriteStats: function (rows) {
		if (!this._visible || this.data.tabIndex !== 0) return;
		const updates = new Map(rows.map(row => [row.id, row]));
		const dataList = this.data.dataList;
		const patch = { favoriteSyncError: false };
		let changed = !!this.data.favoriteSyncError;
		if (dataList && Array.isArray(dataList.list)) patch.dataList = { ...dataList, list: dataList.list.map(order => {
			const stat = updates.get(order._id);
			if (stat && (order.MAIL_FAV_CNT !== stat.count || order.MAIL_IS_FAV !== !!stat.isFav || order.MAIL_CAN_FAV !== !!stat.available)) changed = true;
			return stat ? { ...order, MAIL_FAV_CNT: stat.count, MAIL_IS_FAV: !!stat.isFav, MAIL_CAN_FAV: !!stat.available } : order;
		}) };
		if (changed) this.setData(patch);
	},
	bindRefreshFavorites: function () { if (this._favoriteWatcher) return this._favoriteWatcher.refresh(); },
	bindFavoriteTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		const order = (this.data.dataList && this.data.dataList.list || []).find(row => row._id === id);
		if (!order || this.data.favoriteBusyId || (!order.MAIL_IS_FAV && order.MAIL_CAN_FAV === false)) return;
		this.setData({ favoriteBusyId: id });
		if (this._favoriteWatcher) this._favoriteWatcher.invalidate();
		try {
			if (!await PassportBiz.loginMustCancelWin(this) || !this._visible) return;
			const result = await Favorites.setFavorite(id, !order.MAIL_IS_FAV);
			if (this._favoriteWatcher) this._favoriteWatcher.invalidate();
			if (this._visible) {
				this._applyFavoriteStats([result]);
				pageHelper.showSuccToast(result.isFav ? '已收藏订单' : '已取消收藏');
			}
		} catch (error) { if (this._visible) Ops.error(error); }
		finally { if (!this._unloaded) this.setData({ favoriteBusyId: '' }); }
	},

	_reloadActiveList: function () {
		// 切回页面时刷新当前分段
		const ids = ['#cmpt-list-take', '#cmpt-list-mine', '#cmpt-list-posted', '#cmpt-list-done'];
		const list = this.selectComponent(ids[this.data.tabIndex]);
		if (list && typeof list.reload === 'function') {
			return list.reload();
		}
	},
	_syncOrders: async function () {
		if (!this._visible) return;
		const tab = this.data.tabIndex;
		const list = this.selectComponent(['#cmpt-list-take', '#cmpt-list-mine', '#cmpt-list-posted', '#cmpt-list-done'][tab]);
		if (!list) return;
		const result = await (typeof list.refresh === 'function' ? list.refresh() : list.reload());
		if (this._visible && this.data.tabIndex === tab) this.setData({ orderSyncError: !!(result && result.ok === false) });
		return result;
	},

	onPullDownRefresh: async function () {
		try { await this._reloadActiveList(); await this.bindRefreshFavorites(); }
		finally { wx.stopPullDownRefresh(); }
	},

	/**
	 * cmpt-comm-list 回传列表数据
	 */
	bindCommListCmpt: function (e) {
		if (!this._visible) return;
		const type = e.detail && e.detail.type;
		if (type && type !== ['order-mail-take', 'order-mail-mine', 'order-mail-posted', 'order-mail-done'][this.data.tabIndex]) return;
        if (e.detail && e.detail.dataList && Array.isArray(e.detail.dataList.list)) {
			this._dataListUser = PassportBiz.getUserId ? PassportBiz.getUserId() : '';
            const dataList = Object.assign({}, e.detail.dataList, { list: e.detail.dataList.list.map(order => this._decorateOrder(order)) });
            this.setData({ dataList });
			// Older cached lists do not contain the counts included by mail/list.
			if (e.detail.dataList.list.some(order => order.MAIL_FAV_CNT === undefined)) this.bindRefreshFavorites();
            if (e.detail.sortType) this.setData({ sortType: e.detail.sortType });
            return;
        }
		pageHelper.commListListener(this, e);
	},

    _decorateOrder: function (order) {
        const obj = order && order.MAIL_OBJ || {};
        const progress = MailUI.progress(order);
        let packages = Array.isArray(obj.packages) ? obj.packages : [];
        if (!packages.length && obj.code) {
            packages = String(obj.code).split(/\r?\n/).filter(Boolean).map(code => ({ code }));
        }
		return Object.assign({}, order, {
			showProgress: progress.visible, progressStep: progress.step, progressSteps: progress.steps, progressLabels: progress.steps.map(step => step.label),
			deliveryAddress: MailUI.deliveryAddress(order), receipt: MailUI.receipt(order),
			MAIL_FAV_CNT: Number(order.MAIL_FAV_CNT) || 0, MAIL_IS_FAV: !!order.MAIL_IS_FAV,
			packageProofs: packages.filter(item => item && typeof item === 'object').map(item => ({ pickupPoint: item.pickupPoint || obj.address1 || '', code: obj.serviceType === 'send' ? item.note || '请联系发布者交接' : item.code || '查看取件截图', noteLabel: item.note ? '有备注' : '无备注' }))
		});
    },
	_snapshotKey: function (tab) {
		const user = PassportBiz.getUserId ? PassportBiz.getUserId() : '';
		return (Ops.scopeKey ? Ops.scopeKey() : '') + ':' + user + ':' + tab + ':' + JSON.stringify(this.data.listParams[['take', 'mine', 'posted', 'done'][tab]]);
	},

	/**
	 * 顶部 tab 切换
	 */
	bindTabTap: function (e) {
		const idx = Number(e.currentTarget.dataset.idx);
		if (!Number.isInteger(idx) || idx < 0 || idx > 3 || idx === this.data.tabIndex) return;
		const snapshots = this._tabSnapshots || (this._tabSnapshots = new Map());
		const identity = PassportBiz.getUserId ? PassportBiz.getUserId() : '';
		if (this.data.dataList && !this.data.dataList.error && this._dataListUser === identity) snapshots.set(this._snapshotKey(this.data.tabIndex), { at: Date.now(), value: this.data.dataList });
		const saved = snapshots.get(this._snapshotKey(idx));
		// Show this tab's recent data immediately; its component still fetches the
		// current server state. Snapshots are scoped by identity and filters.
		this.setData({
			tabIndex: idx,
			dataList: saved && Date.now() - saved.at < 60000 ? saved.value : null,
		});
		if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
		this._startFavoriteSync();
	},

	/**
	 * 把当前筛选合并进四个 Tab 的参数。筛选只改 orderBy/whereEx，
	 * 各 Tab 的 sortType 保持不变。
	 */
	_buildListParams: function (filter) {
		const listParams = {};
		['take', 'mine', 'posted', 'done'].forEach(key => {
			listParams[key] = OrderFilter.buildParams(this.data.listParams[key], filter);
		});
		return listParams;
	},

	_applyFilter: function (next) {
		const filter = Object.assign(OrderFilter.emptyFilter(), next || {});
		const summarize = typeof OrderFilter.deliverSummary === 'function' ? OrderFilter.deliverSummary : () => '';
		const text = typeof OrderFilter.summaryText === 'function' ? OrderFilter.summaryText : () => '';
		this.setData({
			filter,
			listParams: this._buildListParams(filter),
			filterActive: OrderFilter.count(filter) > 0,
			deliverText: summarize(filter),
			pickupText: text(filter.pickup)
		});
	},

	/** 「全部」= 清空所有筛选条件（含地点多选）。 */
	bindFilterReset: function () {
		if (!this.data.filterActive) return;
		this._applyFilter(OrderFilter.emptyFilter());
	},

	bindTogglePrice: function () {
		this._applyFilter(Object.assign({}, this.data.filter, { price: !this.data.filter.price }));
	},

	bindToggleUrgent: function () {
		this._applyFilter(Object.assign({}, this.data.filter, { urgent: !this.data.filter.urgent }));
	},

	/**
	 * 地点筛选弹层：送达地点与取件地点共用一套面板。
	 * 送达地点的选项就是「所在地点」那套（宿舍区 + 校内地点），另加「其他」= 下单时没选地点；
	 * 取件地点就是下单时「选择常用快递点」那套（快递点之下才是快递公司）。
	 */
	bindOpenLocSheet: function (e) {
		e = e || {};
		const dim = (e.currentTarget && e.currentTarget.dataset.dim) === 'pickup' ? 'pickup' : 'deliver';
		const filter = this.data.filter || {};
		const selected = new Set((filter[dim] || []).map(item => String(item || '').trim()).filter(Boolean));
		const groups = ((this._filterSources || {})[dim] || []).map(group => ({
			key: group.key,
			title: group.title,
			hint: group.hint || '',
			items: (group.items || []).map(item => ({ label: item.label, value: item.value, name: item.name || '', on: selected.has(item.value) }))
		}));
		// 内容少就让面板贴着内容（不留一大片空白），条目多才固定高度、中间滚动，
		// 两种情况底部「已选／确定」都露在外面。rpx 估值：组头 60，每行 90。
		const height = groups.reduce((sum, group) => sum + (group.items.length ? 60 + Math.ceil(group.items.length / 3) * 90 : 0), 0);
		this.setData({
			locSheet: dim,
			locGroups: groups,
			locTall: dim === 'deliver' || height > 840,
			locOther: dim === 'deliver' && !!filter.deliverOther
		});
		this._syncLocState();
	},

	/** 同步底部「已选」文案与数量，两个维度共用。 */
	_syncLocState: function () {
		const picked = [];
		(this.data.locGroups || []).forEach(group => (group.items || []).forEach(item => { if (item.on) picked.push(item.value); }));
		if (this.data.locOther) picked.push('其他');
		this.setData({ locCount: picked.length, locSummary: picked.length ? picked.join('、') : '未选择' });
	},

	bindCloseLocSheet: function () {
		this.setData({ locSheet: '', locGroups: [], locTall: false, locOther: false, locCount: 0, locSummary: '' });
	},

	bindLocToggle: function (e) {
		const g = Number(e.currentTarget.dataset.g), i = Number(e.currentTarget.dataset.i);
		const group = (this.data.locGroups || [])[g];
		const item = group && group.items && group.items[i];
		if (!item) return;
		if (!item.on && this.data.locCount >= OrderFilter.MAX_PLACES) return pageHelper.showNoneToast('最多选择' + OrderFilter.MAX_PLACES + '项');
		this.setData({ ['locGroups[' + g + '].items[' + i + '].on']: !item.on });
		this._syncLocState();
	},

	/** 「其他」只对送达地点有意义：下单时没选地点、按详细地址送达的订单。 */
	bindLocToggleOther: function () {
		if (this.data.locSheet !== 'deliver') return;
		if (!this.data.locOther && this.data.locCount >= OrderFilter.MAX_PLACES) return pageHelper.showNoneToast('最多选择' + OrderFilter.MAX_PLACES + '个地点');
		this.setData({ locOther: !this.data.locOther });
		this._syncLocState();
	},

	bindLocClear: function () {
		this.setData({
			locGroups: (this.data.locGroups || []).map(group => Object.assign({}, group, {
				items: (group.items || []).map(item => Object.assign({}, item, { on: false }))
			})),
			locOther: false
		});
		this._syncLocState();
	},

	bindLocConfirm: function () {
		const dim = this.data.locSheet;
		if (!dim) return;
		const picked = [];
		(this.data.locGroups || []).forEach(group => (group.items || []).forEach(item => { if (item.on) picked.push(item.value); }));
		const next = Object.assign({}, this.data.filter);
		next[dim] = picked.slice(0, OrderFilter.MAX_PLACES);
		if (dim === 'deliver') next.deliverOther = !!this.data.locOther;
		this.bindCloseLocSheet();
		this._applyFilter(next);
	},

	/**
	 * 跳转到详情页
	 * - 可接单 Tab（status=0）：用 mail_detail（接单详情页），底部显示「立即接单」
	 * - 我接的 / 已完成 Tab：用 mail_my_detail（我的订单详情页），按角色显示操作
	 */
	bindDetailTap: function (e) {
		const id = e.currentTarget.dataset.id;
		if (!id) return;
		const tab = this.data.tabIndex;
		if (tab === 0) {
			wx.navigateTo({
				url: pageHelper.fmtURLByPID('/pages/mail/detail/mail_detail?id=' + id),
			});
		} else {
			wx.navigateTo({
				url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + id),
			});
		}
	},

	/**
	 * 立即接单 - mail/accept（已存在）
	 */
	bindAcceptTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		if (!id || this._accepting) return;
		this._accepting = true;
		this.setData({ acceptingId: id });
		try {
			if (!await PassportBiz.loginMustCancelWin(this) || !this._visible) return;
			const confirm = await pageHelper.showConfirm('确认接单后请按订单要求尽快取件或购买，是否继续？');
			if (!confirm || !this._visible) return;
			const res = {data:await Ops.command('mail/accept', { id })};
			if (!this._visible) return;

			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast('接单成功');
				PublicBiz.removeCacheList('order-mail-take');
				wx.navigateTo({
					url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + id),
				});
			} else {
				pageHelper.showNoneToast('手慢了，订单已被接走');
			}
		} catch (err) {
			if (this._visible) { Ops.error(err); await this._syncOrders(); }
		} finally { this._accepting = false; if (!this._unloaded) this.setData({ acceptingId: '' }); }
	},

	/** 发布者从列表发起收货确认，详情页读取最新状态后执行现有核对流程。 */
	bindConfirmReceiptTap: function (e) {
		const id = e.currentTarget.dataset.id;
		const order = (this.data.dataList && this.data.dataList.list || []).find(row => row._id === id);
		if (!id || !this._visible || this.data.tabIndex !== 2 || !order || !MailUI.receipt(order).visible || this.data.confirmingId) return;
		this.setData({ confirmingId: id });
		wx.navigateTo({
			url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(id) + '&action=confirm'),
			fail: error => { if (this._visible) Ops.error(error); },
			complete: () => { if (!this._unloaded) this.setData({ confirmingId: '' }); },
		});
	},

	/**
	 * 联系发单人（拨打电话）
	 */
	bindCallTap: function (e) {
		const tel = e.currentTarget.dataset.tel;
		if (!tel) {
			pageHelper.showNoneToast('暂无联系方式');
			return;
		}
		wx.makePhoneCall({ phoneNumber: String(tel) });
	},

	/** 接单人更新取件/送达进度，每一步都先二次确认。 */
	bindOrderAction: async function (e) {
		const id = e.currentTarget.dataset.id;
		const action = e.currentTarget.dataset.action;
		const order = (this.data.dataList && this.data.dataList.list || []).find(row => row._id === id);
		const expectedStatus = { pickup: 1, deliver: 4 }[action];
		if (!id || !this._visible || this.data.tabIndex !== 1 || !order || !order.myaccept || expectedStatus === undefined || Number(order.MAIL_STATUS) !== expectedStatus || this._orderActionBusy) return;
		this._orderActionBusy = true;
		this.setData({ actionBusyId: id });
		try {
			const message = action === 'pickup' ? '确认已经取齐或购齐本单所有物品吗？接下来将进入订单详情上传凭证（照片或视频），提交后进入配送中。' : '确认已将本单所有包裹送到收件地址吗？接下来将进入订单详情，选择放置指定位置或当面交付并提交凭证。';
			if (!await pageHelper.showConfirm(message) || !this._visible || this.data.tabIndex !== 1) return;
			const current = (this.data.dataList && this.data.dataList.list || []).find(row => row._id === id);
			if (!current || !current.myaccept || Number(current.MAIL_STATUS) !== expectedStatus) return;
			// 取件与送达都需要凭证，统一进入订单详情填写。
			await new Promise((resolve, reject) => wx.navigateTo({
				url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(id) + '&panel=' + action),
				success: resolve, fail: reject,
			}));
			return;
		} catch (err) { if (this._visible) { Ops.error(err); await this._syncOrders(); } }
		finally { this._orderActionBusy = false; if (!this._unloaded) this.setData({ actionBusyId: '' }); }
	},

	bindComplaintTap: function (e) {
		const id = e.currentTarget.dataset.id;
		if (id) wx.navigateTo({ url: pageHelper.fmtURLByPID('/pages/feedback/index/feedback_index?orderId=' + encodeURIComponent(id)) });
	},

	bindOverTap: function (e) { this.bindDetailTap(e); },

	bindReviewTap: function (e) {
		const id = e.currentTarget.dataset.id;
		const order = (this.data.dataList && this.data.dataList.list || []).find(row => row._id === id);
		if (order && (order.MAIL_CAN_REVIEW || order.MAIL_REVIEWED)) wx.navigateTo({ url: '/projects/crun/pages/my/review_add/review_add?orderId=' + encodeURIComponent(id) });
	},

	/**
	 * 阻止事件冒泡（卡片点击区域内，actions 区按钮不希望触发卡片 tap）
	 */
	bindStop: function () {},
 bindStopProp: function () {},

	url: function (e) {
		pageHelper.url(e, this);
	},
});
