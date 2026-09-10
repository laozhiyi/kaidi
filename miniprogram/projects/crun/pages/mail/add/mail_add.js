const ProfileBiz = require('../../../biz/profile_biz.js');
const MailUI = require('../../../biz/mail_ui_biz.js');
const Ops = require('../../../biz/operations_biz.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const contentCheckHelper = require('../../../../../helper/content_check_helper.js');
const MailBiz = require('../../../biz/mail_biz.js');
const validate = require('../../../../../helper/validate.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

// 展示与提交费用使用服务端配置，不在配置失败时套用本地价格。
// 与价格档对应的预估重量(kg)，仅用于表单中"预估重量"字段
const MAIL_WEIGHTS = [1, 3, 5];

Page({
	data: {
		isLoad: false,
		serviceState: { kind: 'loading', canPublish: false }, campusIndex: 0,
		packageTypes: [
			{ mark: 'small', label: '小件', price: '1.50', count: 1 },
			{ mark: 'medium', label: '中件', price: '3.00', count: 0 },
			{ mark: 'large', label: '大件', price: '5.00', count: 0 },
		],
		totalCount: 1,
		totalFee: '1.50',
        customPrice: '',
		urgent: false,
		config:null,campuses:[],campus:'',configError:false,loadError:'',pageLoading:false,submitting:false,
		proofImages: [], proofPreview:{}, packageItems: [], profileContacts: [], profileAddresses: [], contactPickerVisible: false, addressPickerVisible: false,
		mailValues: {
			code: '',
			address1: '',
			address2: '',
			poster: '',
			tel: '',
			tel2: '',
			desc: '',
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
		if (!options || !options.embedded) { if (!await PassportBiz.loginMustBackWin(this)) return; }

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
            if (copy.mark === 'img') copy.max = 6;
            if (copy.mark === 'price') copy.title = '代取费用(元)';
			return copy;
		});
		formData.fields.push(
			{ mark: 'small', title: '小件数量', type: 'int', must: false },
			{ mark: 'medium', title: '中件数量', type: 'int', must: false },
			{ mark: 'large', title: '大件数量', type: 'int', must: false },
			{ mark: 'urgent', title: '加急订单', type: 'switch', must: false }
		);
		formData.formForms = [
			{ mark: 'title', title: '快递名称', type: 'text', val: '快递代取' },
			{ mark: 'num', title: '快递件数', type: 'int', val: '1' },
			{ mark: 'weight', title: '预估重量(kg)', type: 'int', val: '1' },
			{ mark: 'price', title: '代取费用(元)', type: 'digit', val: '1.50' },
			{ mark: 'code', title: '取件码', type: 'textarea', val: '' },
			{ mark: 'img', title: '相关图片', type: 'image', val: [] },
			{ mark: 'address1', title: '快递点', type: 'text', val: '' },
			{ mark: 'address2', title: '收件地址', type: 'textarea', val: '' },
			{ mark: 'poster', title: '联系人', type: 'text', val: '' },
			{ mark: 'tel', title: '手机号', type: 'mobile', val: '' },
			{ mark: 'tel2', title: '第二联系方式', type: 'text', val: '' },
			{ mark: 'desc', title: '备注', type: 'textarea', val: '' },
			{ mark: 'small', title: '小件数量', type: 'int', val: '1' },
			{ mark: 'medium', title: '中件数量', type: 'int', val: '0' },
			{ mark: 'large', title: '大件数量', type: 'int', val: '0' },
			{ mark: 'urgent', title: '加急订单', type: 'switch', val: false },
		];

		this.setData(Object.assign(formData, {
			isLoad: false,
			formEnd: new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,16).replace('T',' '),
		}));

		// 动态设置导航栏标题
		if (!options || !options.embedded) wx.setNavigationBarTitle({ title: editId ? '编辑快递代取' : '发布快递代取' });

		this._formReady = true;
		await this._loadProfileDefaults();
		await this.bindRetryLoad();
 },
 async _loadProfileDefaults() {
  try {
   if (!PassportBiz.isLogin()) return;
   const user = await cloudHelper.callCloudData('passport/my_detail', {}, { hint: false });
   if (!user) return;
   const profile = ProfileBiz.readProfile(user);
   this._profileCampus = profile.campus;
   this._profileDefaults = { address2: profile.address2, poster: profile.poster, tel: profile.tel, tel2: profile.tel2 };
   this.setData({ profileContacts: profile.contacts, profileAddresses: profile.addresses });
   // Refresh auto-filled fields, but never replace this order's explicit choices or saved details.
   if (!this.data.editId) {
    Object.keys(this._profileDefaults).forEach(mark => {
     if (!this._profileEdited || !this._profileEdited[mark]) this._setFormVal(mark, this._profileDefaults[mark]);
    });
    if (!this._campusEdited && this.data.campuses.includes(profile.campus)) {
     this.setData({ campus: profile.campus, campusIndex: this.data.campuses.indexOf(profile.campus) });
    }
   }
  } catch (e) { console.warn('[mail_add] profile defaults unavailable', e); }
 },
 async bindRetryLoad() {
  if (!this._formReady || this._loadingPage || this._submitting) return;
  this._loadingPage = true;
  this.setData({ pageLoading: true, configError: false, loadError: '' });
  try {
   const config = await Ops.get('operations/config');
   const prices = config && [config.smallPrice, config.mediumPrice, config.largePrice];
   if (!config || typeof config.enabled !== 'boolean' || config.paymentMode !== 'offline'
    || !prices.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
    || !Number.isInteger(config.maxPackages) || config.maxPackages < 1
    || !Array.isArray(config.campuses) || !config.campuses.length
    || config.campuses.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error('运营配置不完整，请联系管理员检查价格与服务校区');
   }
   this._prices = prices;
   this.setData({ serviceState: MailUI.service(config) });
   const preferredCampus = this._profileCampus && config.campuses.includes(this._profileCampus) ? this._profileCampus : this.data.campus;
   this.setData({ config, campuses: config.campuses,
    campus: config.campuses.includes(preferredCampus) ? preferredCampus : config.campuses[0],
    campusIndex: Math.max(0, config.campuses.indexOf(preferredCampus)) });
   if (this.data.mailValues) {
    ['address2','poster','tel','tel2'].forEach(mark => { if (this._profileDefaults && !this.data.mailValues[mark] && this._profileDefaults[mark]) this._setFormVal(mark, this._profileDefaults[mark]); });
   }
   if (this.data.editId && !this._editLoaded) {
    await this._loadForEdit(this.data.editId);
    this._editLoaded = true;
   }
   this.setData({ packageTypes: this.data.packageTypes.map((x, i) => ({ ...x, price: prices[i].toFixed(2) })) }); this._syncPackageItems(this.data.packageItems); this._refreshFee();
   this.setData({ isLoad: true });
  } catch (e) {
   console.error('[mail_add] load', e);
   this.setData({ configError: true, loadError: e && (e.msg || e.message) || '加载失败，请稍后重试' });
  } finally {
   this._loadingPage = false;
   this.setData({ pageLoading: false });
  }
 },
  async onShow() { if (this.data.config) this.setData({ serviceState: MailUI.service(this.data.config) }); if (this._formReady) { await this._loadProfileDefaults(); const picker = this._profilePickerAfterReturn; if (picker && ((picker === 'address' && this.data.profileAddresses.length) || (picker === 'contact' && this.data.profileContacts.length))) { this._profilePickerAfterReturn = ''; this.setData({ addressPickerVisible: picker === 'address', contactPickerVisible: picker === 'contact' }); } } },
 bindCampusChange(e) { const campusIndex = Number(e.detail.value); this._campusEdited = true; this.setData({ campusIndex, campus: this.data.campuses[campusIndex] }); },
 bindServiceHelpTap() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); },
 bindSettlementTap() { wx.showModal({ title: '关于线下结算', content: this.data.config.offlineNotice, showCancel: false, confirmText: '我知道了' }); },
 _packageRows(previous = this.data.packageItems) { const rows=[]; const old=Array.isArray(previous)?previous:[]; let nextId=0; this.data.packageTypes.forEach(type => { for(let i=0;i<type.count;i++){ const prior=old.find(x=>x.type===type.mark && !rows.some(y=>y.id===x.id)); rows.push(prior ? {...prior,label:type.label} : {id:type.mark+'-'+(++nextId),type:type.mark,label:type.label,price:type.price,code:'',note:'',images:[]}); } }); return rows; },
 _syncPackageItems(previous) { const rows=this._packageRows(previous); this.setData({packageItems:rows}); this._setFormVal('packages',rows); },
 _refreshFee(){const reference=this.data.packageTypes.reduce((sum,x,i)=>sum+x.count*this._prices[i],0);const total=this.data.packageItems.length ? this.data.packageItems.reduce((sum,x)=>sum+(Number(x.price)||0),0) : reference;const referencePrice=reference.toFixed(2);this.setData({totalFee:total.toFixed(2),referencePrice});this._setFormVal('price',total.toFixed(2));},
 bindPackageItemInput(e){const index=Number(e.currentTarget.dataset.index);const mark=e.currentTarget.dataset.mark;let items=this.data.packageItems.map((item,i)=>i===index?{...item,[mark]:e.detail.value}:item); if(mark==='code' && String(e.detail.value || '').trim() && items[index] && items[index].images && items[index].images.length){ items[index]=Object.assign({},items[index],{images:[]}); } this.setData({packageItems:items});this._setFormVal('packages',items);if(mark==='price')this._refreshFee();},
 bindCustomPrice(e){const value=String(e.detail.value||'').replace(/[^0-9.]/g,'');this.setData({customPrice:value});this._setFormVal('price',value);},

 /** 编辑模式：拉取原订单数据回填 */
	_loadForEdit: async function (id) {
		try {

			const res = await cloudHelper.callCloudSumbit('mail/view', { id }, { hint: false });

			const mail = res && res.data ? res.data : null;
			if (!mail || !mail._id) {
				throw new Error('订单不存在或已删除');
			}

			if (!mail.mypost || mail.MAIL_STATUS !== 0) throw new Error('该订单不可编辑，请返回订单详情');
			const obj = mail.MAIL_OBJ || {};
			this.setData({campus:obj.campus||this.data.campus,campusIndex:Math.max(0,this.data.campuses.indexOf(obj.campus||this.data.campus))});
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
			const storedPackages = findStoredFormVal('packages', Array.isArray(obj.packages) ? obj.packages : []);
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
				{ mark: 'tel2', title: '第二联系方式', type: 'text', val: String(obj.tel2 || findFormVal('tel2', '')) },
				{ mark: 'desc', title: '备注', type: 'textarea', val: String(obj.desc || findFormVal('desc', '')) },
				{ mark: 'small', title: '小件数量', type: 'int', val: String(packageTypes[0].count) },
				{ mark: 'medium', title: '中件数量', type: 'int', val: String(packageTypes[1].count) },
				{ mark: 'large', title: '大件数量', type: 'int', val: String(packageTypes[2].count) },
				{ mark: 'urgent', title: '加急订单', type: 'switch', val: !!obj.urgent },
			];

			// 原始文件 ID 用于编辑提交；预览使用鉴权后生成的临时地址。
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
				tel2: String(obj.tel2 || ''),
				desc: String(obj.desc || ''),
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
                packageItems: Array.isArray(storedPackages) && storedPackages.length ? storedPackages : [],
				mailValues,
				formForms,
				proofImages,
    proofPreview:Object.fromEntries(proofImages.map((id,i)=>[id,mail.MAIL_MEDIA && mail.MAIL_MEDIA.pickup[i] || ''])),
				formEnd,
				formCateId,
				totalCount,
				totalFee,
				urgent: !!obj.urgent,
                customPrice: totalFee,
				moreRequirements: !!obj.desc,
			}, () => {
				// form-show 没有对 forms 属性做自动重载；编辑模式下显式刷新，避免提交时仍使用默认值。
				const form = this.selectComponent('#cmpt-form');
				if (form && typeof form.reload === 'function') form.reload();
			});
		} catch (err) {
			console.error('[mail_add] load for edit', err);
			throw err;
		}
	},

	onPullDownRefresh: async function () {
		await this.bindRetryLoad();
		wx.stopPullDownRefresh();
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	_setFormVal: function (mark, val) {
		const form = this.selectComponent('#cmpt-form');
		if (form) form.setOneFormVal(mark, val);
		if (this.data.formForms) this.setData({ formForms: this.data.formForms.map(item => item.mark === mark ? { ...item, val } : item) });
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
 if(step>0 && currentTotal>=this.data.config.maxPackages){wx.showToast({title:'已达到每单件数上限',icon:'none'});return;}
		packages[index] = Object.assign({}, packages[index], { count: nextCount });

		let totalCount = 0;
		let totalFee = 0;
		let totalWeight = 0;
		for (let k = 0; k < packages.length; k++) {
			totalCount += packages[k].count;
			totalFee += packages[k].count * this._prices[k];
			totalWeight += packages[k].count * MAIL_WEIGHTS[k];
		}
		this.setData({
			packageTypes: packages,
			totalCount,
			totalFee: totalFee.toFixed(2),
		});
		this._setFormVal('num', String(totalCount));
		this._setFormVal('weight', String(Math.max(1, totalWeight)));
		this._refreshFee();
		this._setFormVal('small', String(packages[0].count));
		this._setFormVal('medium', String(packages[1].count));
		this._setFormVal('large', String(packages[2].count));
        this._syncPackageItems(this.data.packageItems);
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
		const left = 6 - this.data.proofImages.length;
		if (left <= 0) {
			wx.showToast({ title: '最多上传6张截图', icon: 'none' });
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
				const images = this.data.proofImages.concat(selected).slice(0, 6);
				this.setData({ proofImages: images });
				this._setFormVal('img', images);
			},
		});
	},

	bindPreviewImage: function (e) {
		wx.previewImage({
			urls: this.data.proofImages.map(x=>this.data.proofPreview[x]||x),
			current: this.data.proofPreview[this.data.proofImages[Number(e.currentTarget.dataset.index)]] || this.data.proofImages[Number(e.currentTarget.dataset.index)],
		});
	},

	bindRemoveImage: function (e) {
		const images = this.data.proofImages.slice();
		images.splice(Number(e.currentTarget.dataset.index), 1);
		this.setData({ proofImages: images });
		this._setFormVal('img', images);
	},


	bindPackageImageTap: function (e) {
		const index = Number(e.currentTarget.dataset.index); const current = this.data.packageItems[index];
		if (current && String(current.code || '').trim()) { wx.showToast({ title: '取件码和截图二选一', icon: 'none' }); return; }
		wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: res => {
			const file = res.tempFiles && res.tempFiles[0]; if (!file) return;
			if (!contentCheckHelper.imgTypeCheck(file.tempFilePath) || !contentCheckHelper.imgSizeCheck(file.size, 1024 * 1000 * 10)) { wx.showToast({ title: '图片格式或大小不符合要求', icon: 'none' }); return; }
			const items = this.data.packageItems.slice(); items[index] = Object.assign({}, items[index], { images: [file.tempFilePath], code: '' });
			this.setData({ packageItems: items }); this._setFormVal('packages', items);
		} });
	},
	bindPackagePreviewImage: function (e) { const item = this.data.packageItems[Number(e.currentTarget.dataset.index)]; if (item && item.images && item.images.length) wx.previewImage({ urls: item.images, current: item.images[0] }); },
	bindChooseProfileAddress: function () { if (this.data.profileAddresses && this.data.profileAddresses.length) this.setData({ addressPickerVisible: true }); else { this._profilePickerAfterReturn = 'address'; wx.navigateTo({ url: '/projects/crun/pages/my/edit/my_edit' }); } },
	bindChooseProfileContact: function () { if (this.data.profileContacts && this.data.profileContacts.length) this.setData({ contactPickerVisible: true }); else { this._profilePickerAfterReturn = 'contact'; wx.navigateTo({ url: '/projects/crun/pages/my/edit/my_edit' }); } },
	bindCloseProfilePicker: function () { this.setData({ addressPickerVisible: false, contactPickerVisible: false }); },
	bindSelectProfileAddress: function (e) { const item = this.data.profileAddresses[Number(e.currentTarget.dataset.index)]; if (item) this._setFormVal('address2', item.detail); this.setData({ addressPickerVisible: false }); },
	bindSelectProfileContact: function (e) { const item = this.data.profileContacts[Number(e.currentTarget.dataset.index)]; if (item) { this._setFormVal('poster', item.name); this._setFormVal('tel', item.phone); } this.setData({ contactPickerVisible: false }); },

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

	_showMailList: function () { if (this.data.embedded) { this.triggerEvent('published', { id: this.data.mailId }); return; } PublicBiz.removeCacheList('admin-mail-list');
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


  _uploadPackageImages: async function (items) {
   const rows = Array.isArray(items) ? JSON.parse(JSON.stringify(items)) : [];
   for (const row of rows) { if (row.images && row.images.length) row.images = await Ops.upload(row.images); else row.images = []; }
   return rows;
  },
 bindFormSubmit: async function () {
  const serviceState = MailUI.service(this.data.config);
  this.setData({ serviceState });
  if (!this.data.editId && this.data.config && this.data.config.enabled === true && !serviceState.canPublish) { Ops.error(new Error(serviceState.description)); return; }
  if (!this.data.config || this.data.configError || this.data.pageLoading || (this.data.config.enabled !== true && !this.data.editId)) { Ops.error(new Error('请先加载有效运营配置，并确认服务已开放')); return; }
  if(this._submitting || !this.data.config)return;
  if(!await PassportBiz.loginMustCancelWin(this) || this._submitting)return;
  let data=validate.check(this.data,MailBiz.CHECK_FORM,this);if(!data)return;
  const form=this.selectComponent('#cmpt-form');const current=form && form.getForms(true);if(!current)return;
  this._submitting=true;this.setData({submitting:true});
  try {
   wx.showLoading({title:'上传并保存中',mask:true});
   const forms=JSON.parse(JSON.stringify(current)).filter(x=>x.mark!=='campus'&&x.mark!=='formEnd'&&x.mark!=='packages');
    const packageRows = await this._uploadPackageImages((Array.isArray(this.data.packageItems) ? this.data.packageItems : []).map(({_used,...item})=>item));
    forms.push({mark:'packages',title:'逐件凭证',type:'json',val:packageRows});
   for(const item of forms)if(item.type==='image')item.val=await Ops.upload(item.val||[]);
   forms.push({mark:'campus',title:'校区',type:'text',val:this.data.campus});
   if(data.end)forms.push({mark:'formEnd',title:'接单截止时间',type:'date',val:data.end});
   const params={forms,cateId:data.cateId,price:String(this.data.totalFee)};if(this.data.editId)params.id=this.data.editId;
   const result=await Ops.command(this.data.editId?'mail/edit':'mail/insert',params);
   this.setData({mailId:result._id||result.id});wx.hideLoading();PublicBiz.removeCacheList('mail-list');
   wx.showModal({title:this.data.editId?'保存成功':'发布成功',content:this.data.config.offlineNotice,showCancel:false,success:()=>this._showMailList()});
  }catch(e){wx.hideLoading();Ops.error(e);}finally{this._submitting=false;this.setData({submitting:false});}
 },
});
