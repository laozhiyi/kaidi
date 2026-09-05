const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const contentCheckHelper = require('../../../../../helper/content_check_helper.js');
const MailBiz = require('../../../biz/mail_biz.js');
const validate = require('../../../../../helper/validate.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

// 快递代取价格档：自定价，单位元
// 小件：日常小包裹/信封文件，¥1.50
// 中件：常规尺寸纸箱，¥3.00
// 大件：体积较大或较重的纸箱，¥5.00
const MAIL_PRICES = [1.5, 3.0, 5.0];
// 与价格档对应的预估重量(kg)，仅用于表单中"预估重量"字段
const MAIL_WEIGHTS = [1, 3, 5];

Page({
	data: {
		isLoad: false,
		packageTypes: [
			{ mark: 'small', label: '小件', price: '1.50', count: 1 },
			{ mark: 'medium', label: '中件', price: '3.00', count: 0 },
			{ mark: 'large', label: '大件', price: '5.00', count: 0 },
		],
		totalCount: 1,
		totalFee: '1.50',
		moreRequirements: false,
		proofImages: [],
		mailValues: {
			code: '',
			address1: '',
			address2: '',
			poster: '',
			tel: '',
			desc: '',
			rider: '',
		},
	},

	onLoad: async function () {
		ProjectBiz.initPage(this);
		if (!await PassportBiz.loginMustBackWin(this)) return;

		const formData = MailBiz.initFormData();
		// The client validator expects the category id in string form.
		formData.formCateId = String(formData.formCateId || '');
		// Keep the shared field definitions, but code and screenshot are an either/or pair here.
		formData.fields = formData.fields.map((field) => {
			const copy = Object.assign({}, field, { ext: Object.assign({}, field.ext || {}) });
			if (copy.mark === 'code') copy.must = false;
			return copy;
		});
		formData.fields.push({ mark: 'rider', title: '指定骑手', type: 'text', max: 30, must: false });
		formData.formForms = [
			{ mark: 'title', title: '快递名称', type: 'text', val: '快递代取' },
			{ mark: 'num', title: '快递件数', type: 'int', val: '1' },
			{ mark: 'weight', title: '预估重量(kg)', type: 'int', val: '1' },
			{ mark: 'price', title: '打赏金额(元)', type: 'digit', val: '1.50' },
			{ mark: 'code', title: '取件码', type: 'textarea', val: '' },
			{ mark: 'img', title: '相关图片', type: 'image', val: [] },
			{ mark: 'rider', title: '指定骑手', type: 'text', val: '' },
		];

		this.setData(Object.assign(formData, {
			isLoad: true,
			formEnd: '',
		}));
	},

	onPullDownRefresh: async function () {
		wx.stopPullDownRefresh();
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	_setFormVal: function (mark, val) {
		const form = this.selectComponent('#cmpt-form');
		if (form) form.setOneFormVal(mark, val);
		this.setData({ ['mailValues.' + mark]: val });
	},

	_getFormVal: function (forms, mark) {
		for (let k = 0; k < forms.length; k++) {
			if (forms[k].mark === mark) return forms[k].val;
		}
		return '';
	},

	bindPackageTap: function (e) {
		const index = Number(e.currentTarget.dataset.index);
		const step = Number(e.currentTarget.dataset.step);
		const packages = this.data.packageTypes.slice();
		const nextCount = Math.max(0, packages[index].count + step);
		const currentTotal = packages.reduce((sum, item) => sum + item.count, 0);
		if (step < 0 && currentTotal <= 1) return;
		packages[index] = Object.assign({}, packages[index], { count: nextCount });

		let totalCount = 0;
		let totalFee = 0;
		let totalWeight = 0;
		for (let k = 0; k < packages.length; k++) {
			totalCount += packages[k].count;
			totalFee += packages[k].count * MAIL_PRICES[k];
			totalWeight += packages[k].count * MAIL_WEIGHTS[k];
		}
		this.setData({
			packageTypes: packages,
			totalCount,
			totalFee: totalFee.toFixed(2),
		});
		this._setFormVal('num', String(totalCount));
		this._setFormVal('weight', String(Math.max(1, totalWeight)));
		this._setFormVal('price', totalFee.toFixed(2));
	},

	bindMailInput: function (e) {
		const mark = e.currentTarget.dataset.mark;
		const value = e.detail.value;
		this._setFormVal(mark, value);
	},

	bindPasteCode: function () {
		wx.getClipboardData({
			success: (res) => {
				if (res.data) this._setFormVal('code', String(res.data).trim());
			},
		});
	},

	bindUploadImageTap: function () {
		const left = 8 - this.data.proofImages.length;
		if (left <= 0) {
			wx.showToast({ title: '最多上传8张截图', icon: 'none' });
			return;
		}
		wx.chooseMedia({
			count: left,
			mediaType: ['image'],
			sizeType: ['compressed'],
			sourceType: ['album', 'camera'],
			success: (res) => {
				const selected = [];
				for (let k = 0; k < res.tempFiles.length; k++) {
					const file = res.tempFiles[k];
					if (!contentCheckHelper.imgTypeCheck(file.tempFilePath)) {
						wx.showToast({ title: '只能上传jpg、jpeg或png图片', icon: 'none' });
						continue;
					}
					if (!contentCheckHelper.imgSizeCheck(file.size, 1024 * 1000 * 10)) {
						wx.showToast({ title: '单张图片不能超过10M', icon: 'none' });
						continue;
					}
					selected.push(file.tempFilePath);
				}
				const images = this.data.proofImages.concat(selected).slice(0, 8);
				this.setData({ proofImages: images });
				this._setFormVal('img', images);
			},
		});
	},

	bindPreviewImage: function (e) {
		wx.previewImage({
			urls: this.data.proofImages,
			current: this.data.proofImages[Number(e.currentTarget.dataset.index)],
		});
	},

	bindRemoveImage: function (e) {
		const images = this.data.proofImages.slice();
		images.splice(Number(e.currentTarget.dataset.index), 1);
		this.setData({ proofImages: images });
		this._setFormVal('img', images);
	},

	bindMoreChange: function (e) {
		this.setData({ moreRequirements: !!e.detail.value });
	},

	bindEndSelect: function (e) {
		this.setData({ formEnd: e.detail, formEndFocus: '' });
	},

	_showMailList: function () {
		PublicBiz.removeCacheList('admin-mail-list');
		PublicBiz.removeCacheList('mail-list');
		wx.redirectTo({
			url: '/projects/crun/pages/mail/index/mail_index?type=wait&sortType=wait&sortVal=wait',
		});
	},

	_submitWithoutPayment: function () {
		pageHelper.showSuccToast('发布成功', 2000, () => this._showMailList());
	},

	bindFormSubmit: async function () {
		if (!await PassportBiz.loginMustCancelWin(this)) return;

		let data = validate.check(this.data, MailBiz.CHECK_FORM, this);
		if (!data) return;

		const form = this.selectComponent('#cmpt-form');
		const forms = form && form.getForms(true);
		if (!forms) return;

		const code = String(this._getFormVal(forms, 'code') || '').trim();
		const images = this._getFormVal(forms, 'img');
		if (!code && (!Array.isArray(images) || images.length === 0)) {
			wx.showModal({ title: '提示', content: '请填写取件码或上传取件截图' });
			return;
		}

		if (data.formEnd && !forms.some((item) => item.mark === 'formEnd')) {
			forms.push({ mark: 'formEnd', title: '接单截止时间', type: 'date', val: data.formEnd });
		}
		data.forms = forms;
		data.cateName = MailBiz.getCateName(data.cateId);

		let totalFee = parseFloat(this._getFormVal(forms, 'price')) || 0;
		try {
			wx.showLoading({ title: '创建订单中...' });
			const result = await cloudHelper.callCloudSumbit('mail/insert', {
				forms,
				cateId: data.cateId,
				totalFee,
			});
			const resultData = result && result.data ? result.data : {};
			const mailId = resultData.id;
			const mailDbId = resultData._id || mailId;

			if (mailDbId) await cloudHelper.transFormsTempPics(forms, 'mail/', mailDbId, 'mail/update_forms');
			wx.hideLoading();

			if (totalFee <= 0) {
				this._submitWithoutPayment();
				return;
			}

			const payRes = await cloudHelper.callCloudSumbit('pay/create', {
				orderId: mailId,
				totalFee,
				description: '快递代取服务费',
			});
			if (!payRes || !payRes.data) {
				wx.showToast({ title: '获取支付参数失败', icon: 'none' });
				return;
			}

			wx.requestPayment({
				timeStamp: payRes.data.timeStamp,
				nonceStr: payRes.data.nonceStr,
				package: payRes.data.package,
				signType: 'MD5',
				paySign: payRes.data.paySign,
				success: () => {
					wx.showToast({ title: '支付成功', icon: 'success' });
					setTimeout(() => this._showMailList(), 1500);
				},
				fail: () => {
					wx.showModal({
						title: '提示',
						content: '订单已创建，请在订单列表中完成支付',
						confirmText: '查看订单',
						success: (res) => {
							if (res.confirm) this._showMailList();
						},
					});
				},
			});
		} catch (err) {
			wx.hideLoading();
			console.error('[mail_add]', err);
			wx.showToast({ title: err.message || '发布失败', icon: 'none' });
		}
	},
});
