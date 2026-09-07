const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');

/**
 * 快递代取 - 接单/订单 Tab 页
 * 四个分段：
 *   0 可接单（浏览全部待接订单）    mail/list + sortType='wait'
 *   1 我接的（已接单未完成）        mail/list + search='我的接单' + sortType='status',sortVal='1'
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

		// 每次进入都清掉缓存列表，强制刷新一次
		PublicBiz.removeCacheList('order-mail-take');
		PublicBiz.removeCacheList('order-mail-mine');
		PublicBiz.removeCacheList('order-mail-posted');
		PublicBiz.removeCacheList('order-mail-done');
	},

	onShow: function () {
		const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
		if (tabBar) tabBar.setData({ selected: 1 });
		const pendingTab = wx.getStorageSync('crun-order-tab');
		if (pendingTab !== '' && pendingTab !== null && pendingTab !== undefined) {
			wx.removeStorageSync('crun-order-tab');
			const idx = Number(pendingTab);
			if (idx >= 0 && idx <= 3 && idx !== this.data.tabIndex) {
				this.setData({ tabIndex: idx, dataList: null }, () => this._reloadActiveList());
				return;
			}
		}
		this._reloadActiveList();
	},

	_reloadActiveList: function () {
		// 切回页面时刷新当前分段
		const ids = ['#cmpt-list-take', '#cmpt-list-mine', '#cmpt-list-posted', '#cmpt-list-done'];
		const list = this.selectComponent(ids[this.data.tabIndex]);
		if (list && typeof list.reload === 'function') {
			list.reload();
		}
	},

	onPullDownRefresh: async function () {
		wx.stopPullDownRefresh();
	},

	/**
	 * cmpt-comm-list 回传列表数据
	 */
	bindCommListCmpt: function (e) {
		pageHelper.commListListener(this, e);
	},

	/**
	 * 顶部 tab 切换
	 */
	bindTabTap: function (e) {
		const idx = Number(e.currentTarget.dataset.idx);
		if (idx === this.data.tabIndex) return;
		// 切换分段时清掉旧列表，避免新组件加载期间短暂显示上一分段内容。
		this.setData({
			tabIndex: idx,
			dataList: null,
		});
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
				'MAIL_OBJ.address1': ['like', phaseVal],
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
		if (!id) return;

		if (!await PassportBiz.loginMustCancelWin(this)) return;

		const confirm = await pageHelper.showConfirm('确认接单后请尽快前往快递点取件，是否继续？');
		if (!confirm) return;

		try {
			wx.showLoading({ title: '接单中...' });
			const res = await cloudHelper.callCloudSumbit('mail/accept', { id });
			wx.hideLoading();

			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast('接单成功');
				PublicBiz.removeCacheList('order-mail-take');
				setTimeout(() => wx.redirectTo({
					url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + id),
				}), 700);
			} else {
				pageHelper.showNoneToast('手慢了，订单已被接走');
			}
		} catch (err) {
			wx.hideLoading();
			pageHelper.showNoneToast(err.message || '接单失败');
		}
	},

	/** 为尚未支付的自有订单发起支付，并在成功后刷新发布列表。 */
	bindPayTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		const index = Number(e.currentTarget.dataset.index);
		const list = this.data.dataList && this.data.dataList.list;
		const order = list && list[index];
		if (!id || !order) return;
		if (!await PassportBiz.loginMustCancelWin(this)) return;

		const cents = Number(order.MAIL_TOTAL_FEE || 0);
		const totalFee = cents > 0 ? cents / 100 : Number(order.MAIL_OBJ && order.MAIL_OBJ.price);
		if (!(totalFee > 0)) {
			pageHelper.showNoneToast('订单金额无效');
			return;
		}
		try {
			wx.showLoading({ title: '获取支付信息...' });
			const payRes = await cloudHelper.callCloudSumbit('pay/create', {
				orderId: order.MAIL_ID || id,
				totalFee,
				description: '快递代取服务费',
			});
			wx.hideLoading();
			if (!payRes || !payRes.data) {
				pageHelper.showNoneToast('获取支付参数失败');
				return;
			}
			await new Promise((resolve, reject) => {
				wx.requestPayment({
					timeStamp: payRes.data.timeStamp,
					nonceStr: payRes.data.nonceStr,
					package: payRes.data.package,
					signType: 'MD5',
					paySign: payRes.data.paySign,
					success: resolve,
					fail: reject,
				});
			});
			pageHelper.showSuccToast('支付成功');
			PublicBiz.removeCacheList('order-mail-posted');
			const postedList = this.selectComponent('#cmpt-list-posted');
			if (postedList && typeof postedList.reload === 'function') {
				setTimeout(() => postedList.reload(), 1000);
			}
		} catch (err) {
			wx.hideLoading();
			if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
			pageHelper.showNoneToast((err && err.message) || '支付失败，请稍后重试');
		}
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

	/**
	 * 完成订单 - 发布者或接单人确认配送完成
	 */
	bindOverTap: async function (e) {
		const id = e.currentTarget.dataset.id;
		if (!id) return;

		const confirm = await pageHelper.showConfirm('确认已送达并将订单标记完成？');
		if (!confirm) return;

		try {
			wx.showLoading({ title: '提交中...' });
			const res = await cloudHelper.callCloudSumbit('mail/finish', { id });
			wx.hideLoading();
			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast('已完成');
				// 刷新当前 tab
				const list = this.selectComponent('#cmpt-list-mine');
				if (list && typeof list.reload === 'function') list.reload();
			} else {
				pageHelper.showNoneToast('操作失败，请稍后再试');
			}
		} catch (err) {
			wx.hideLoading();
			pageHelper.showNoneToast(err.message || '操作失败');
		}
	},

	/**
	 * 跳转到发布订单
	 */
	bindPublishTap: function () {
		wx.navigateTo({
			url: '/projects/crun/pages/mail/add/mail_add',
		});
	},

	/**
	 * 阻止事件冒泡（卡片点击区域内，actions 区按钮不希望触发卡片 tap）
	 */
	bindStop: function () {},

	url: function (e) {
		pageHelper.url(e, this);
	},
});
