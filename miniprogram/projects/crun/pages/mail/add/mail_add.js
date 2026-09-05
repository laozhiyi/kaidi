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
		urgent: false,
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
		// 快递点（期数）选择弹层
		pickStationVisible: false,
		pickStations: [
			{ name: '一期', list: ['菜鸟', '丰巢'] },
			{ name: '二期', list: ['中通', '圆通', '申通', '韵达', '顺丰'] },
			{ name: '三期', list: ['京东', '德邦'] },
			{ name: '四期', list: ['丹鸟'] },
			{ name: '五期', list: ['邮政', '极兔'] },
		],
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		if (!await PassportBiz.loginMustBackWin(this)) return;

		// 编辑模式：带上 id 参数时，从云端拉取原订单回填表单
		const editId = (options && options.id) || '';
		this.setData({ editId });

		const formData = MailBiz.initFormData();
		// The client validator expects the category id in string form.
		formData.formCateId = String(formData.formCateId || '');
		// Keep the shared field definitions, but code and screenshot are an either/or pair here.
		formData.fields = formData.fields.map((field) => {
			const copy = Object.assign({}, field, { ext: Object.assign({}, field.ext || {}) });
			if (copy.mark === 'code') copy.must = false;
			return copy;
		});
		formData.fields.push(
			{ mark: 'rider', title: '指定骑手', type: 'text', max: 30, must: false },
			{ mark: 'small', title: '小件数量', type: 'int', must: false },
			{ mark: 'medium', title: '中件数量', type: 'int', must: false },
			{ mark: 'large', title: '大件数量', type: 'int', must: false },
			{ mark: 'urgent', title: '加急订单', type: 'switch', must: false }
		);
		formData.formForms = [
			{ mark: 'title', title: '快递名称', type: 'text', val: '快递代取' },
			{ mark: 'num', title: '快递件数', type: 'int', val: '1' },
			{ mark: 'weight', title: '预估重量(kg)', type: 'int', val: '1' },
			{ mark: 'price', title: '打赏金额(元)', type: 'digit', val: '1.50' },
			{ mark: 'code', title: '取件码', type: 'textarea', val: '' },
			{ mark: 'img', title: '相关图片', type: 'image', val: [] },
			{ mark: 'address1', title: '快递点', type: 'text', val: '' },
			{ mark: 'address2', title: '收件地址', type: 'textarea', val: '' },
			{ mark: 'poster', title: '联系人', type: 'text', val: '' },
			{ mark: 'tel', title: '手机号', type: 'mobile', val: '' },
			{ mark: 'desc', title: '补充说明', type: 'textarea', val: '' },
			{ mark: 'rider', title: '指定骑手', type: 'text', val: '' },
			{ mark: 'small', title: '小件数量', type: 'int', val: '1' },
			{ mark: 'medium', title: '中件数量', type: 'int', val: '0' },
			{ mark: 'large', title: '大件数量', type: 'int', val: '0' },
			{ mark: 'urgent', title: '加急订单', type: 'switch', val: false },
		];

		this.setData(Object.assign(formData, {
			isLoad: true,
			formEnd: '',
		}));

		// 动态设置导航栏标题
		wx.setNavigationBarTitle({
			title: editId ? '编辑快递代取' : '发布快递代取',
		});

		if (editId) {
			await this._loadForEdit(editId);
		}
	},

	/** 编辑模式：拉取原订单数据回填 */
	_loadForEdit: async function (id) {
		try {
			wx.showLoading({ title: '加载中...' });
			const res = await cloudHelper.callCloudSumbit('mail/view', { id });
			wx.hideLoading();
			const mail = res && res.data ? res.data : null;
			if (!mail || !mail._id) {
				wx.showToast({ title: '订单不存在', icon: 'none' });
				return;
			}

			const obj = mail.MAIL_OBJ || {};
			const storedForms = Array.isArray(mail.MAIL_FORMS) ? mail.MAIL_FORMS : [];
			const findStoredFormVal = (mark, def) => {
				for (let k = 0; k < storedForms.length; k++) {
					if (storedForms[k].mark === mark) return storedForms[k].val;
				}
				return def;
			};

			// 回填：件数选择器
			const small = Number(obj.small != null ? obj.small : findStoredFormVal('small', 0)) || 0;
			const medium = Number(obj.medium != null ? obj.medium : findStoredFormVal('medium', 0)) || 0;
			const large = Number(obj.large != null ? obj.large : findStoredFormVal('large', 0)) || 0;
			const packageTypes = [
				{ mark: 'small', label: '小件', price: '1.50', count: small },
				{ mark: 'medium', label: '中件', price: '3.00', count: medium },
				{ mark: 'large', label: '大件', price: '5.00', count: large },
			];
			// 件数至少 1（如果数据库里全是 0，兜底成 1 件小件）
			if (small + medium + large === 0) {
				packageTypes[0].count = 1;
			}

			// 回填：表单引擎的 formForms
			const findFormVal = (mark, def) => {
				return findStoredFormVal(mark, def);
			};

			const formForms = [
				{ mark: 'title', title: '快递名称', type: 'text', val: findFormVal('title', '快递代取') },
				{ mark: 'num', title: '快递件数', type: 'int', val: String(findFormVal('num', small + medium + large || 1)) },
				{ mark: 'weight', title: '预估重量(kg)', type: 'int', val: String(findFormVal('weight', 1)) },
				{ mark: 'price', title: '打赏金额(元)', type: 'digit', val: String(obj.price || findFormVal('price', '1.50')) },
				{ mark: 'code', title: '取件码', type: 'textarea', val: String(obj.code || findFormVal('code', '')) },
				{ mark: 'img', title: '相关图片', type: 'image', val: Array.isArray(findFormVal('img', [])) ? findFormVal('img', []) : [] },
				{ mark: 'address1', title: '快递点', type: 'text', val: String(obj.address1 || findFormVal('address1', '')) },
				{ mark: 'address2', title: '收件地址', type: 'textarea', val: String(obj.address2 || findFormVal('address2', '')) },
				{ mark: 'poster', title: '联系人', type: 'text', val: String(obj.poster || findFormVal('poster', '')) },
				{ mark: 'tel', title: '手机号', type: 'mobile', val: String(obj.tel || findFormVal('tel', '')) },
				{ mark: 'desc', title: '补充说明', type: 'textarea', val: String(obj.desc || findFormVal('desc', '')) },
				{ mark: 'rider', title: '指定骑手', type: 'text', val: String(obj.rider || findFormVal('rider', '')) },
				{ mark: 'small', title: '小件数量', type: 'int', val: String(packageTypes[0].count) },
				{ mark: 'medium', title: '中件数量', type: 'int', val: String(packageTypes[1].count) },
				{ mark: 'large', title: '大件数量', type: 'int', val: String(packageTypes[2].count) },
				{ mark: 'urgent', title: '加急订单', type: 'switch', val: !!obj.urgent },
			];

			// 回填：取件截图本地预览（obj.imgUrl 是云端 fileID，可直接当 image src 渲染）
			let proofImages = [];
			if (Array.isArray(obj.imgUrls)) proofImages = obj.imgUrls.filter(Boolean);
			else if (Array.isArray(obj.imgUrl)) proofImages = obj.imgUrl.filter(Boolean);
			else if (obj.imgUrl) proofImages = [obj.imgUrl];
			const imageForm = formForms.find((item) => item.mark === 'img');
			if (imageForm && proofImages.length) imageForm.val = proofImages;

			// 回填：联系人信息
			const mailValues = {
				code: String(obj.code || ''),
				address1: String(obj.address1 || ''),
				address2: String(obj.address2 || ''),
				poster: String(obj.poster || ''),
				tel: String(obj.tel || ''),
				desc: String(obj.desc || ''),
				rider: String(obj.rider || ''),
			};

			// 回填：截止时间
			const formEnd = mail.end2 || mail.MAIL_END_TIME || obj.end || '';

			// 回填：分类
			const formCateId = String(mail.MAIL_CATE_ID || this.data.formCateId || '');

			// 总价 = 件数档位价求和（数据库里存的 price 是发布人定价，保留）
			const totalFee = String(obj.price != null ? obj.price : findFormVal('price', '1.50'));
			const totalCount = (small + medium + large) || 1;

			this.setData({
				packageTypes,
				mailValues,
				formForms,
				proofImages,
				formEnd,
				formCateId,
				totalCount,
				totalFee,
				urgent: !!obj.urgent,
				moreRequirements: !!obj.desc,
			}, () => {
				// form-show 没有对 forms 属性做自动重载；编辑模式下显式刷新，避免提交时仍使用默认值。
				const form = this.selectComponent('#cmpt-form');
				if (form && typeof form.reload === 'function') form.reload();
			});
		} catch (err) {
			wx.hideLoading();
			console.error('[mail_add] load for edit', err);
			wx.showToast({ title: '加载原订单失败', icon: 'none' });
		}
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
		this._setFormVal('small', String(packages[0].count));
		this._setFormVal('medium', String(packages[1].count));
		this._setFormVal('large', String(packages[2].count));
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
		const enabled = !!e.detail.value;
		this.setData({ moreRequirements: enabled });
		if (!enabled) this._setFormVal('desc', '');
	},

	bindUrgentChange: function (e) {
		const urgent = !!e.detail.value;
		this.setData({ urgent });
		this._setFormVal('urgent', urgent);
	},

	bindEndSelect: function (e) {
		this.setData({ formEnd: e.detail, formEndFocus: '' });
	},

	bindOpenPickStation: function () {
		this.setData({ pickStationVisible: true });
	},

	bindClosePickStation: function () {
		this.setData({ pickStationVisible: false });
	},

	bindSelectPickStation: function (e) {
		const phase = e.currentTarget.dataset.phase;
		const name = e.currentTarget.dataset.name;
		const value = phase + ' · ' + name;
		this._setFormVal('address1', value);
	},

	bindStopProp: function () {},

	_showMailList: function () {
		PublicBiz.removeCacheList('admin-mail-list');
		PublicBiz.removeCacheList('mail-list');
		PublicBiz.removeCacheList('order-mail-take');
		PublicBiz.removeCacheList('order-mail-posted');
		PublicBiz.removeCacheList('order-mail-mine');
		PublicBiz.removeCacheList('order-mail-done');
		// 跳到「我的订单详情」页，方便发布者继续查看
		const mailId = this.data.mailId;
		if (mailId) {
			wx.redirectTo({
				url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + mailId),
			});
		} else {
			wx.navigateBack();
		}
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

		if (!String(this.data.mailValues.address1 || '').trim()) {
			wx.showModal({ title: '提示', content: '请选择快递点' });
			return;
		}
		if (!String(this.data.mailValues.address2 || '').trim()) {
			wx.showModal({ title: '提示', content: '请填写收件地址' });
			return;
		}
		if (!String(this.data.mailValues.poster || '').trim()) {
			wx.showModal({ title: '提示', content: '请填写联系人' });
			return;
		}
		if (!/^1[1-9]\d{9}$/.test(String(this.data.mailValues.tel || '').trim())) {
			wx.showModal({ title: '提示', content: '请填写正确的手机号' });
			return;
		}

		if (data.formEnd && !forms.some((item) => item.mark === 'formEnd')) {
			forms.push({ mark: 'formEnd', title: '接单截止时间', type: 'date', val: data.formEnd });
		}
		data.forms = forms;
		data.cateName = MailBiz.getCateName(data.cateId);

		const isEdit = !!this.data.editId;

		let totalFee = parseFloat(this._getFormVal(forms, 'price')) || 0;
		try {
			wx.showLoading({ title: isEdit ? '保存中...' : '创建订单中...' });

			if (isEdit) {
				// 编辑模式：调 mail/edit，不走支付
				const editRes = await cloudHelper.callCloudSumbit('mail/edit', {
					id: this.data.editId,
					forms,
					cateId: data.cateId,
				});
				const ok = editRes && editRes.data && editRes.data.id;
				if (ok) {
					await cloudHelper.transFormsTempPics(forms, 'mail/', this.data.editId, 'mail/update_forms');
					wx.hideLoading();
					PublicBiz.removeCacheList('admin-mail-list');
					PublicBiz.removeCacheList('mail-list');
					pageHelper.showSuccToast('修改成功', 1500, () => {
						wx.navigateBack();
					});
				} else {
					wx.hideLoading();
					pageHelper.showNoneToast('修改失败，请稍后重试');
				}
				return;
			}

			// 发布模式
			const result = await cloudHelper.callCloudSumbit('mail/insert', {
				forms,
				cateId: data.cateId,
				totalFee,
			});
			const resultData = result && result.data ? result.data : {};
			const mailId = resultData.id;
			const mailDbId = resultData._id || mailId;
			// 以后端按件数重算的金额为准，避免客户端表单值与支付金额不一致。
			totalFee = Number(resultData.fee != null ? resultData.fee : totalFee) || 0;
			// 暂存订单 id，发布完成后跳转到「我的订单详情」
			this.setData({ mailId: mailDbId });

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
