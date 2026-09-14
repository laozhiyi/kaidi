const Ops = require('../../../biz/operations_biz.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');
const Favorites = require('../../../biz/order_fav_biz.js');
const OrderSync = require('../../../biz/order_sync_biz.js');

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

		// 筛选条 - 附加排序（合并到 takeParams.orderBy，不影响 sortType）
		sortVal: '',

		// 地点筛选（一期/二期/三期/四期/五期/全部）
		phaseOptions: [
			{ label: '全部', value: '' },
			{ label: '一期', value: '一期' },
			{ label: '二期', value: '二期' },
			{ label: '三期', value: '三期' },
			{ label: '四期', value: '四期' },
			{ label: '五期', value: '五期' },
		],
		phaseVal: '',
		phasePickerVisible: false,

		// 列表数据（cmpt-comm-list 通过 bind:list 回填）
		dataList: null,
		favoriteBusyId: '', favoriteSyncError: false, acceptingId: '', actionBusyId: '', orderSyncError: false,
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
        let packages = Array.isArray(obj.packages) ? obj.packages : [];
        if (!packages.length && obj.code) {
            packages = String(obj.code).split(/\r?\n/).filter(Boolean).map(code => ({ code }));
        }
		return Object.assign({}, order, { MAIL_FAV_CNT: Number(order.MAIL_FAV_CNT) || 0, MAIL_IS_FAV: !!order.MAIL_IS_FAV, packageProofs: packages.map(item => ({ pickupPoint: item.pickupPoint || obj.address1 || '', code: item.code || '查看取件截图', noteLabel: item.note ? '有备注' : '无备注' })) });
    },
	_snapshotKey: function (tab) {
		const user = PassportBiz.getUserId ? PassportBiz.getUserId() : '';
		return user + ':' + tab + ':' + JSON.stringify(this.data.listParams[['take', 'mine', 'posted', 'done'][tab]]);
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

	_buildTakeParams: function (sortVal, phaseVal) {
		const params = Object.assign({}, this.data.listParams.take);
		delete params.orderBy;
		delete params.whereEx;

		if (sortVal === 'price_desc') {
			params.orderBy = { 'MAIL_OBJ.price': 'desc' };
		} else if (sortVal === 'urgent') {
			params.whereEx = { 'MAIL_OBJ.urgent': true };
		}

		if (phaseVal) {
			params.whereEx = Object.assign({}, params.whereEx, {
				'MAIL_OBJ.address2': ['like', phaseVal],
			});
		}
		return params;
	},

	/**
	 * 筛选条 - 通过 orderBy 注入排序，不影响 tab 的 sortType/sortVal
	 */
	bindSortTap: function (e) {
		let val = e.currentTarget.dataset.val || '';
		if (val === this.data.sortVal) val = '';

		const takeParams = this._buildTakeParams(val, this.data.phaseVal);

		const listParams = Object.assign({}, this.data.listParams, { take: takeParams });
		this.setData({ sortVal: val, listParams });
	},

	/**
	 * 地点筛选弹层
	 */
	bindOpenPhasePicker: function () {
		this.setData({ phasePickerVisible: true });
	},

	bindClosePhasePicker: function () {
		this.setData({ phasePickerVisible: false });
	},

	bindPhaseSelect: function (e) {
		const value = e.currentTarget.dataset.value || '';
		const label = e.currentTarget.dataset.label || '全部';
		if (value === this.data.phaseVal) {
			this.setData({ phasePickerVisible: false });
			return;
		}

		const takeParams = this._buildTakeParams(this.data.sortVal, value);
		const listParams = Object.assign({}, this.data.listParams, { take: takeParams });
		this.setData({
			phaseVal: value,
			phaseLabel: label,
			phasePickerVisible: false,
			listParams,
		});
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
			const confirm = await pageHelper.showConfirm('确认接单后请尽快前往快递点取件，是否继续？');
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

	/** 为尚未支付的自有订单发起支付，并在成功后刷新发布列表。 */
	bindPayTap: function () { pageHelper.showNoneToast('当前版本仅支持线下结算，不提供微信支付'); },

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

	/**
	 * 完成订单 - 发布者或接单人确认配送完成
	 */
	/** 接单人更新取件/送达进度，每一步都先二次确认。 */
	bindOrderAction: async function (e) {
		const id = e.currentTarget.dataset.id;
		const action = e.currentTarget.dataset.action;
		if (!id || !['pickup', 'deliver'].includes(action) || this._orderActionBusy) return;
		this._orderActionBusy = true;
		this.setData({ actionBusyId: id });
		try {
			const message = action === 'pickup' ? '确认已经从快递点取到该包裹吗？' : '确认已经将包裹送到收件地址吗？';
			if (!await pageHelper.showConfirm(message)) return;
			if (action === 'deliver') {
				wx.navigateTo({ url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(id) + '&panel=deliver') });
				return;
			}
			await Ops.command('mail/pickup', { id });
			pageHelper.showSuccToast('已更新为已取件');
			PublicBiz.removeCacheList('order-mail-mine');
			await this._syncOrders();
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
