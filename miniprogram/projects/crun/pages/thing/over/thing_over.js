const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({
	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false,

		id: '', // 订单ID
		thing: {}, // 订单详情
		acceptInfo: {}, // 接单人信息（不可修改）
		postInfo: {}, // 发布人信息
		simpleForms: [], // 简单表单字段
		formRows: [], // 简单表单字段按两列分组后的二维数组
		overDesc: '', // 补充说明文字

		pickupPicList: [], // 取件照片（临时路径）
		deliverPicList: [], // 接收照片（临时路径）
		overDescPicList: [], // 补充说明照片（临时路径）

		isRecipient: false, // 当前用户是否为接单人
		isPublisher: false, // 当前用户是否为发布人
		isExpired: false, // 订单是否已过期（待接单 + 超时）
		nowMs: 0, // 当前时间戳（用于模板比较）
		defaultStatus: '待接单',
		submitting: false,
	},

	/**
	 * 生命周期函数
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		if (!options || !options.id) {
			this.setData({ isLoad: null });
			return;
		}

		this.setData({ id: options.id });

		if (!await PassportBiz.loginMustBackWin(this)) return;

		this._loadDetail();
	},

	_loadDetail: async function () {
		let id = this.data.id;
		if (!id) return;

		let params = { id };
		let opt = { title: 'bar' };

		let thing = await cloudHelper.callCloudData('thing/view', params, opt);
		if (!thing) {
			this.setData({ isLoad: null });
			return;
		}

		let isRecipient = !!thing.myaccept;
		let isPublisher = !!thing.mypost;

		// 仅允许发布人或接单人访问
		if (!isRecipient && !isPublisher) {
			pageHelper.showNoneToast('仅订单发布人或接单人可访问');
			setTimeout(() => {
				wx.navigateBack({ delta: 1 });
			}, 1000);
			this.setData({ isLoad: null });
			return;
		}

		// 默认状态
		let defaultStatus = '待接单';
		let st = Number(thing.THING_STATUS);
		if (st === 1) defaultStatus = '已接单';
		else if (st === 9) defaultStatus = '已完成';
		else if (st === 99) defaultStatus = '已取消';

		// 处理简单表单字段（只渲染非图片、非 code/tel/img 类型，便于信息展示）
		let simpleForms = [];
		if (Array.isArray(thing.THING_FORMS)) {
			for (let k = 0; k < thing.THING_FORMS.length; k++) {
				let it = thing.THING_FORMS[k] || {};
				if (!it.title) continue;
				if (it.type === 'image') continue;
				if (it.type === 'switch') continue;
				// 跳过取件码字段：在急事代办/快递等场景，取件码一般与"取件数"组合，
				// 这里只展示非取件码的数字类信息
				if (it.mark === 'code') continue;
				let text = it.val;
				if (Array.isArray(text)) text = text.join('、');
				if (text === '' || text === null || text === undefined) continue;
				simpleForms.push({ title: it.title, text: String(text), mark: it.mark });
			}
		}

		// 将表单字段两两分组，便于双列展示
		let formRows = [];
		for (let i = 0; i < simpleForms.length; i += 2) {
			formRows.push(simpleForms.slice(i, i + 2));
		}

		// 是否已过期（仅对待接单状态判断：截止时间已过且未被接单）
		let isExpired = false;
		if (st === 0 && thing.THING_END_TIME) {
			isExpired = Number(thing.THING_END_TIME) < Date.now();
		}

		this.setData({
			isLoad: true,
			thing,
			acceptInfo: thing.acceptUser || {},
			postInfo: thing.postUser || {},
			simpleForms,
			formRows,
			isRecipient,
			isPublisher,
			isExpired,
			nowMs: Date.now(),
			defaultStatus,
		});
	},

	onReady: function () { },
	onShow: function () { },
	onHide: function () { },
	onUnload: function () { },

	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	onReachBottom: function () { },

	url: function (e) {
		pageHelper.url(e, this);
	},

	onPageScroll: function (e) {
		pageHelper.showTopBtn(e, this);
	},

	bindPickupPicUploadCmpt: function (e) {
		this.setData({ pickupPicList: e.detail || [] });
	},

	bindDeliverPicUploadCmpt: function (e) {
		this.setData({ deliverPicList: e.detail || [] });
	},

	bindOverDescPicUploadCmpt: function (e) {
		this.setData({ overDescPicList: e.detail || [] });
	},

	bindCallPhone: function (e) {
		let phone = (e.currentTarget.dataset.phone || '').toString().trim();
		if (!phone) return;
		wx.makePhoneCall({ phoneNumber: phone, fail: () => { } });
	},

	/** 预览图片（相册预览） */
	bindPreviewImgTap: function (e) {
		let url = e.currentTarget.dataset.url;
		let list = e.currentTarget.dataset.list || [];
		if (!url) return;
		wx.previewImage({
			urls: list.length ? list : [url],
			current: url,
			fail: () => { }
		});
	},

	bindShowPayPicTap: function () {
		let url = this.data.thing.THING_ACCEPT_PAY_PIC;
		if (!url) return;
		wx.previewImage({ urls: [url], current: url });
	},

	/** 接单（仅"待接单"状态且当前用户非发布人时可触发） */
	bindAcceptTap: async function () {
		if (this.data.submitting) return;
		if (!await PassportBiz.loginMustBackWin(this)) return;

		let that = this;
		let cb = async () => {
			try {
				that.setData({ submitting: true });
				let id = that.data.id;
				await cloudHelper.callCloudSumbit('thing/accept', { id }, { title: '提交中...' }).then(res => {
					let cb2 = () => {
						wx.redirectTo({ url: '../detail/thing_detail?id=' + id });
					};
					that.setData({ submitting: false });
					pageHelper.showSuccToast('接单成功', 1500, cb2);
				}).catch(err => {
					that.setData({ submitting: false });
					console.error(err);
				});
			} catch (err) {
				that.setData({ submitting: false });
				console.error(err);
			}
		};
		pageHelper.showConfirm('您确认接单？', cb);
	},

	/** 取消订单（接单人调用） */
	bindCancelOrderTap: async function () {
		if (this.data.submitting) return;
		if (!await PassportBiz.loginMustBackWin(this)) return;

		let that = this;
		let cb = async () => {
			try {
				that.setData({ submitting: true });
				let id = that.data.id;
				await cloudHelper.callCloudSumbit('thing/cancel', { id }, { title: '提交中...' }).then(res => {
					let cb2 = () => {
						wx.redirectTo({ url: '../detail/thing_detail?id=' + id });
					};
					that.setData({ submitting: false });
					pageHelper.showSuccToast('已取消该单', 1500, cb2);
				}).catch(err => {
					that.setData({ submitting: false });
					console.error(err);
				});
			} catch (err) {
				that.setData({ submitting: false });
				console.error(err);
			}
		};
		pageHelper.showConfirm('您确认取消该订单？', cb);
	},

	/** 顶部/取消按钮：放弃当前填写的内容并返回 */
	bindCancelTap: function () {
		let that = this;
		let hasInput =
			(this.data.pickupPicList && this.data.pickupPicList.length) ||
			(this.data.deliverPicList && this.data.deliverPicList.length) ||
			(this.data.overDescPicList && this.data.overDescPicList.length) ||
			(this.data.overDesc && this.data.overDesc.trim());

		let cb = () => { wx.navigateBack({ delta: 1 }); };

		if (hasInput) {
			pageHelper.showConfirm('放弃当前填写的内容并返回？', cb);
		} else {
			wx.navigateBack({ delta: 1 });
		}
	},

	/** 提交（接单人：传图+完成；发布人：仅标记完成） */
	bindSubmitTap: async function () {
		if (this.data.submitting) return;

		let that = this;
		let isRecipient = this.data.isRecipient;

		let cb = async () => {
			try {
				that.setData({ submitting: true });

				let id = that.data.id;
				let pickupPic = [];
				let deliverPic = [];
				let overDescPic = [];
				let overDesc = '';

				// 仅接单人需要上传凭证
				if (isRecipient) {
					if (!that.data.pickupPicList || that.data.pickupPicList.length === 0) {
						that.setData({ submitting: false });
						return pageHelper.showModal('请上传取件照片');
					}
					if (!that.data.deliverPicList || that.data.deliverPicList.length === 0) {
						that.setData({ submitting: false });
						return pageHelper.showModal('请上传接收照片');
					}
					let hasText = !!(that.data.overDesc && that.data.overDesc.trim());
					let hasPic = !!(that.data.overDescPicList && that.data.overDescPicList.length);
					if (!hasText && !hasPic) {
						that.setData({ submitting: false });
						return pageHelper.showModal('请填写补充说明或上传补充说明照片（至少一项）');
					}

					wx.showLoading({ title: '图片上传中...', mask: true });

					pickupPic = await cloudHelper.transTempPics(that.data.pickupPicList, 'thing/over/', id, 'pickup');
					deliverPic = await cloudHelper.transTempPics(that.data.deliverPicList, 'thing/over/', id, 'deliver');
					if (that.data.overDescPicList && that.data.overDescPicList.length > 0) {
						overDescPic = await cloudHelper.transTempPics(that.data.overDescPicList, 'thing/over/', id, 'overDesc');
					}
					overDesc = (that.data.overDesc || '').trim();

					wx.hideLoading();
				}

				let params = {
					id,
					status: 9,
					overTime: Date.now(),
					pickupPic,
					deliverPic,
					overDesc,
					overDescPic,
				};

				await cloudHelper.callCloudSumbit('thing/status', params, { title: '提交中...' }).then(res => {
					let callback = () => {
						wx.redirectTo({ url: '../detail/thing_detail?id=' + id });
					};
					that.setData({ submitting: false });
					pageHelper.showSuccToast('已确认完成', 1500, callback);
				}).catch(err => {
					that.setData({ submitting: false });
					console.error(err);
				});
			}
			catch (err) {
				that.setData({ submitting: false });
				wx.hideLoading();
				console.error(err);
			}
		};

		let confirmText = isRecipient ? '确认提交并将该订单标记为已完成？' : '确认将该订单标记为已完成？';
		pageHelper.showConfirm(confirmText, cb);
	},

	onShareAppMessage: function () {
		return {
			title: (this.data.thing && this.data.thing.THING_OBJ && this.data.thing.THING_OBJ.title) || '确认完成',
		};
	}
})
