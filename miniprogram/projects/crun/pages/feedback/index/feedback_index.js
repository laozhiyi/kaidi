const Ops = require('../../../biz/operations_biz.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({
	data: {
		// 投诉对象
		targetArr: [
			{ val: 'manager', label: '校区负责人' },
			{ val: 'rider', label: '接单人' },
			{ val: 'merchant', label: '商家' },
			{ val: 'feedback', label: '功能反馈' },
			{ val: 'poster', label: '订单发布者' }
		],
		targetIdx: -1,
		customShow: false,
		customTarget: '',

		content: '',
		img: [],
		isSubmit: false, submitHint: '', submitError: '',
		orderLinked: false, orderTarget: null, orderLoading: false, orderLoaded: false, orderError: ''
	},

	onLoad: async function (options = {}) {
		ProjectBiz.initPage(this);
		this._orderId=options.orderId||'';
		this.setData({ orderLinked: !!this._orderId });
		if (await PassportBiz.loginMustBackWin(this) && this._orderId) await this.loadOrder();
	},
	onUnload() { this._unloaded = true; },
	async loadOrder() {
		if (!this._orderId || this.data.orderLoading) return;
		this.setData({ orderLoading: true, orderError: '' });
		try {
			const order = await Ops.get('mail/view', { id: this._orderId });
			if (!order || !(order.mypost || order.myaccept)) throw new Error('只能申诉本人参与的订单');
			if (!this._unloaded) this.setData({ orderTarget: order.MAIL_FEEDBACK_TARGET || null, orderLoaded: true });
		} catch (error) { if (!this._unloaded) this.setData({ orderError: error.msg || error.message || '订单信息加载失败，请重试' }); }
		finally { if (!this._unloaded) this.setData({ orderLoading: false }); }
	},

	// 返回
	bindBackTap: function () {
		wx.navigateBack();
	},

	// 切换投诉对象
	bindTargetTap: function (e) {
		if (this.data.isSubmit || this._submitted) return;
		let idx = pageHelper.dataset(e, 'idx');
		this.setData({
			targetIdx: Number(idx),
			customShow: false,
			customTarget: ''
		});
	},

	// 切换到自定义
	bindCustomTap: function () {
		if (this.data.isSubmit || this._submitted) return;
		this.setData({
			targetIdx: -1,
			customShow: true
		});
	},

	// 自定义输入
	bindCustomInput: function (e) {
		if (this.data.isSubmit || this._submitted) return;
		this.setData({ customTarget: e.detail.value });
	},

	// 内容输入
	bindContentInput: function (e) {
		if (this.data.isSubmit || this._submitted) return;
		this.setData({ content: e.detail.value });
	},

	// 选择图片
	bindChooseImage: function () {
		if (this.data.isSubmit || this._submitted || this.data.img.length >= 6) return;
		wx.chooseImage({
			count: 6 - this.data.img.length,
			sizeType: ['compressed'],
			sourceType: ['album', 'camera'],
			success: (res) => {
				if (this._unloaded || this.data.isSubmit || this._submitted) return;
				let img = this.data.img.concat(res.tempFilePaths).slice(0, 6);
				this.setData({ img });
			}
		});
	},

	// 删除图片
	bindDelImage: function (e) {
		if (this.data.isSubmit || this._submitted) return;
		let idx = pageHelper.dataset(e, 'idx');
		let img = this.data.img.slice();
		img.splice(idx, 1);
		this.setData({ img });
	},

	// 预览图片
	bindPreviewImage: function (e) {
		let url = pageHelper.dataset(e, 'url');
		wx.previewImage({
			urls: this.data.img,
			current: url
		});
	},

	// 获取最终投诉对象文本
	_getTargetText: function () {
		if (this.data.orderTarget) return this.data.orderTarget.role + ' · ' + this.data.orderTarget.name;
		let { targetArr, targetIdx, customShow, customTarget } = this.data;
		if (targetIdx >= 0 && targetArr[targetIdx]) {
			return targetArr[targetIdx].label;
		}
		if (customShow && customTarget && customTarget.trim()) {
			return customTarget.trim();
		}
		return '';
	},

	// 提交
	bindSubmitTap: async function () {
		let { content, img, isSubmit } = this.data;

		if (isSubmit || this._submitted) return;
		if (this.data.orderLoading || this.data.orderError || this._orderId && !this.data.orderLoaded) return pageHelper.showNoneToast('请先加载并核实关联订单');

		let targetText = this._getTargetText();
		if (!targetText) {
			return pageHelper.showModal('请选择或填写投诉对象', '温馨提示');
		}
		if (!content || !content.trim()) {
			return pageHelper.showModal('请填写投诉内容', '温馨提示');
		}
		if (content.length > 500) {
			return pageHelper.showModal('内容不能超过500字', '温馨提示');
		}

		this.setData({ isSubmit: true, submitError: '', submitHint: img.length ? '正在上传凭证…' : '正在提交申诉…' });

		try {
			if (!await PassportBiz.loginMustCancelWin(this)) return;
			// 上传图片
			let imgList = [];
			if (img && img.length) {
				imgList = await Ops.upload(img);
			}

			let params = {
				type: !this.data.orderTarget && this.data.targetIdx >= 0 && this.data.targetArr[this.data.targetIdx].val === 'feedback' ? 'suggest' : 'complain',
				title: targetText.substring(0, 60),
				content: content.trim(),
				contact: '',
				img: imgList || []
			};

			params.orderId=this._orderId;
			if (this._unloaded) return;
			this.setData({ submitHint: '正在提交申诉…' });
			await Ops.command('feedback/insert', params, { retries: 2, onRetry: () => {
				if (!this._unloaded) this.setData({ submitHint: '网络波动，正在重试…' });
			} });
			this._submitted = true;
			if (this._unloaded) return;
			wx.showModal({
				title: '提交成功',
				content: '申诉已提交至管理员，可在“我的申诉”查看处理进度和回复',
				showCancel: false,
				success: () => {
					wx.redirectTo({
						url: '../my_list/feedback_my_list'
					});
				}
			});
		} catch (err) {
			console.error(err);
			if (!this._unloaded) {
				this.setData({ submitError: err && (err.msg || err.message) || '网络异常，内容已保留，请重试提交' });
				Ops.error(err);
			}
		} finally {
			if (!this._unloaded) this.setData({ isSubmit: false, submitHint: '' });
		}
	},

	// 查看我的反馈
	bindMyListTap: function () {
		wx.navigateTo({
			url: '../my_list/feedback_my_list'
		});
	},

	onShareAppMessage: function () { }
})
