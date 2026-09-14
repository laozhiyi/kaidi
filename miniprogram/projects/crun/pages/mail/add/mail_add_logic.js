const ProfileBiz = require('../../../biz/profile_biz.js');
const Address = require('../../../biz/address_biz.js');
const Deadline = require('../../../biz/deadline_biz.js');
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

module.exports = {
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
		config:null,campuses:[],campus:'',configError:false,loadError:'',pageLoading:false,submitting:false,hasPendingSubmission:false,
		proofImages: [], proofPreview:{}, packageItems: [], profileContacts: [], profileAddresses: [], contactPickerVisible: false, addressPickerVisible: false,
		mailValues: {
			code: '',
			address2: '',
			poster: '',
			tel: '',
			tel2: '',
			desc: '',
		},
		packagePickupVisible: false, packagePickupId: '', packagePickupNumber: 0, packagePickupDraft: '', packagePickupError: '',
		pickupStations: Address.PICKUP_STATIONS,
		profileAddressIndex: -1, profileContactIndex: -1,
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
			formEnd: Deadline.after(),
		}));

		// 动态设置导航栏标题
		if (!options || !options.embedded) wx.setNavigationBarTitle({ title: editId ? '编辑快递代取' : '发布快递代取' });

		this._formReady = true;
		this._refreshPendingSubmission();
		await Promise.all([this._loadProfileDefaults(), this.bindRetryLoad()]);
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
   if (!this.data.editId) {
    Object.keys(this._profileDefaults).forEach(mark => {
     if (!this._profileEdited || !this._profileEdited[mark]) this._setFormVal(mark, this._profileDefaults[mark]);
    });
    if (!this._campusEdited && this.data.campuses.includes(profile.campus)) this.setData({ campus: profile.campus, campusIndex: this.data.campuses.indexOf(profile.campus) });
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
   const preferredCampus = !this._campusEdited && this._profileCampus && config.campuses.includes(this._profileCampus) ? this._profileCampus : this.data.campus;
   this.setData({ config, campuses: config.campuses,
    campus: config.campuses.includes(preferredCampus) ? preferredCampus : config.campuses[0],
    campusIndex: Math.max(0, config.campuses.indexOf(preferredCampus)) });
   if (this.data.mailValues) {
    ['address2','poster','tel','tel2'].forEach(mark => { if ((!this._profileEdited || !this._profileEdited[mark]) && this._profileDefaults && !this.data.mailValues[mark] && this._profileDefaults[mark]) this._setFormVal(mark, this._profileDefaults[mark]); });
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
  async onShow() {
   this._refreshPendingSubmission();
   if (this.data.config) this.setData({ serviceState: MailUI.service(this.data.config) });
   if (!this._formReady) return;
   await this._loadProfileDefaults();
   const picker = this._profilePickerAfterReturn;
   this._profilePickerAfterReturn = '';
   if (picker === 'address') this.bindChooseProfileAddress();
   if (picker === 'contact') this.bindChooseProfileContact();
  },
 bindCampusChange(e) { const campusIndex = Number(e.detail.value); this._campusEdited = true; this.setData({ campusIndex, campus: this.data.campuses[campusIndex] }); },
 bindServiceHelpTap() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); },
 bindSettlementTap() { wx.showModal({ title: '关于线下结算', content: this.data.config.offlineNotice, showCancel: false, confirmText: '我知道了' }); },
 _packageRows(previous = this.data.packageItems, types = this.data.packageTypes) {
  const rows = [], old = Array.isArray(previous) ? previous : [], used = new Set();
  for (const type of types) {
   for (let i = 0; i < type.count; i++) {
    const index = old.findIndex((row, at) => row && row.type === type.mark && !used.has(at));
    const prior = index >= 0 ? old[index] : null;
    if (prior) used.add(index);
    let id = prior && prior.id;
    if (!id || rows.some(row => row.id === id)) {
     do { this._packageSequence = (this._packageSequence || 0) + 1; id = 'parcel-' + this._packageSequence; }
     while (old.some(row => row && row.id === id) || rows.some(row => row.id === id));
    }
    rows.push({ type: type.mark, price: type.price, code: '', note: '', images: [], pickupPoint: '', ...prior, id, label: type.label, referencePrice: type.price });
   }
  }
  return rows;
 },
 _syncPackageItems(previous) {
  const rows = this._packageRows(previous);
  this.setData({ packageItems: rows }); this._setFormVal('packages', rows);
  if (this.data.packagePickupVisible) {
   const index = rows.findIndex(row => row.id === this.data.packagePickupId);
   if (index < 0) this.bindClosePackagePickup();
   else this.setData({ packagePickupNumber: index + 1 });
  }
 },
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
			const address2 = Address.orderAddress(mail);
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
			const packageValue = Array.isArray(obj.packages) ? obj.packages : findStoredFormVal('packages', []);
			const storedPackages = Array.isArray(packageValue) ? packageValue : [];
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
				{ mark: 'address2', title: '收件地址', type: 'textarea', val: address2 },
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
				address2,
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
			// Older orders stored one pickup point for the whole order; migrate it into each parcel when editing.
			const legacyPickup = String(obj.address1 || findFormVal('address1', ''));
			const packageItems = this._packageRows(Array.isArray(storedPackages) ? storedPackages : [], packageTypes)
				.map((item, index) => ({ ...item, pickupPoint: item.pickupPoint || legacyPickup,
					...(!storedPackages.length && index === 0 ? { code: mailValues.code, images: mailValues.code ? [] : proofImages } : {}) }));

			this.setData({
				packageTypes,
                packageItems,
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
		this._setFormVal('small', String(packages[0].count));
		this._setFormVal('medium', String(packages[1].count));
		this._setFormVal('large', String(packages[2].count));
        this._syncPackageItems(this.data.packageItems);
		this._refreshFee();
	},

	bindMailInput: function (e) {
		const mark = e.currentTarget.dataset.mark;
		const value = e.detail.value;
		this._profileEdited = this._profileEdited || {};
		this._profileEdited[mark] = true;
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


  bindChooseProfileAddress() {
   if (this.data.submitting) return;
   if (wx.hideKeyboard) wx.hideKeyboard();
   const list = this.data.profileAddresses || [];
   const match = list.findIndex(item => Address.formatAddress(item) === this.data.mailValues.address2);
   const fallback = list.findIndex(item => item.isDefault);
   this.setData({ addressPickerVisible: true, contactPickerVisible: false, profileAddressIndex: match >= 0 ? match : fallback });
  },
  bindChooseProfileContact() {
   if (this.data.submitting) return;
   if (wx.hideKeyboard) wx.hideKeyboard();
   const list = this.data.profileContacts || [];
   const match = list.findIndex(item => item.name === this.data.mailValues.poster && item.phone === this.data.mailValues.tel);
   const fallback = list.findIndex(item => item.isDefault);
   this.setData({ contactPickerVisible: true, addressPickerVisible: false, profileContactIndex: match >= 0 ? match : fallback });
  },
  bindCloseProfilePicker() { this.setData({ addressPickerVisible: false, contactPickerVisible: false }); },
  bindSelectProfileAddress(e) {
   const index = Number(e.currentTarget.dataset.index);
   if (Number.isInteger(index) && this.data.profileAddresses[index]) this.setData({ profileAddressIndex: index });
  },
  bindSelectProfileContact(e) {
   const index = Number(e.currentTarget.dataset.index);
   if (Number.isInteger(index) && this.data.profileContacts[index]) this.setData({ profileContactIndex: index });
  },
  bindConfirmProfilePicker() {
   this._profileEdited = this._profileEdited || {};
   if (this.data.addressPickerVisible) {
    const item = this.data.profileAddresses[this.data.profileAddressIndex];
    if (!item) return;
    this._profileEdited.address2 = true;
    this._setFormVal('address2', Address.formatAddress(item));
   } else {
    const item = this.data.profileContacts[this.data.profileContactIndex];
    if (!item) return;
    this._profileEdited.poster = true;
    this._profileEdited.tel = true;
    this._setFormVal('poster', item.name);
    this._setFormVal('tel', item.phone);
   }
   this.bindCloseProfilePicker();
  },
  bindManageProfilePicker() {
   const kind = this.data.addressPickerVisible ? 'address' : 'contact';
   this._profilePickerAfterReturn = kind;
   this.bindCloseProfilePicker();
   wx.navigateTo({ url: kind === 'address' ? '/projects/crun/pages/my/address/address' : '/projects/crun/pages/my/contact/contact' });
  },
  bindPackageImageTap(e) { const index = Number(e.currentTarget.dataset.index); const current=this.data.packageItems[index]; if(current && String(current.code||'').trim()){ wx.showToast({title:'取件码和截图二选一',icon:'none'}); return; } wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: res => { const file = res.tempFiles && res.tempFiles[0]; if (!file) return; if(!contentCheckHelper.imgTypeCheck(file.tempFilePath) || !contentCheckHelper.imgSizeCheck(file.size, 1024*1000*10)){ wx.showToast({title:'图片格式或大小不符合要求',icon:'none'}); return; } const items = this.data.packageItems.slice(); items[index] = Object.assign({}, items[index], { images: [file.tempFilePath], code:'' }); this.setData({ packageItems: items }); this._setFormVal('packages', items); } }); },
  bindPackagePreviewImage(e) { const index = Number(e.currentTarget.dataset.index); const item = this.data.packageItems[index]; if (item && item.images && item.images.length) wx.previewImage({ urls: item.images, current: item.images[0] }); },

	bindUrgentChange: function (e) {
		const urgent = !!e.detail.value;
		this.setData({ urgent });
		this._setFormVal('urgent', urgent);
	},

	bindEndSelect: function (e) {
		this.setData({ formEnd: e.detail, formEndFocus: '' });
	},

 bindOpenPackagePickup(e) {
  if (this.data.submitting) return;
  const index = this.data.packageItems.findIndex(item => item.id === e.currentTarget.dataset.id);
  if (index < 0) return;
  if (wx.hideKeyboard) wx.hideKeyboard();
  this.setData({ packagePickupVisible: true, packagePickupId: this.data.packageItems[index].id, packagePickupNumber: index + 1,
   packagePickupDraft: this.data.packageItems[index].pickupPoint || '', packagePickupError: '' });
 },
 bindClosePackagePickup() {
  this.setData({ packagePickupVisible: false, packagePickupId: '', packagePickupNumber: 0, packagePickupDraft: '', packagePickupError: '' });
 },
 bindSelectPackagePickup(e) {
  if (!this.data.packagePickupVisible || this.data.submitting) return;
  const { phase, name } = e.currentTarget.dataset;
  if (!Address.PICKUP_STATIONS.some(group => group.name === phase && group.list.includes(name))) return;
  this.setData({ packagePickupDraft: phase + ' · ' + name, packagePickupError: '' });
 },
 bindPackagePickupInput(e) { this.setData({ packagePickupDraft: e.detail.value, packagePickupError: '' }); },
 bindConfirmPackagePickup() {
  if (!this.data.packagePickupVisible || this.data.submitting) return;
  const pickupPoint = String(this.data.packagePickupDraft || '').trim();
  if (!pickupPoint || pickupPoint.length > 100) { this.setData({ packagePickupError: '请选择或填写取件点，最多100字' }); return; }
  const index = this.data.packageItems.findIndex(item => item.id === this.data.packagePickupId);
  if (index < 0) { this.bindClosePackagePickup(); return; }
  const items = this.data.packageItems.map((item, at) => at === index ? { ...item, pickupPoint } : item);
  this.setData({ packageItems: items }); this._setFormVal('packages', items);
  this.bindClosePackagePickup();
 },

	bindStopProp: function () {},
	_refreshPendingSubmission() {
		this.setData({ hasPendingSubmission: !!Ops.pendingCommand(this.data.editId ? 'mail/edit' : 'mail/insert', { id: this.data.editId || '' }) });
	},
	async bindRecoverSubmission() {
		if (this._submitting) return;
		this._submitting = true; this.setData({ submitting: true });
		try {
			if (!await PassportBiz.loginMustCancelWin(this)) return;
			const result = await Ops.recoverCommand(this.data.editId ? 'mail/edit' : 'mail/insert', { id: this.data.editId || '' });
			this._refreshPendingSubmission();
			if (result.state === 'committed') {
				const id = result.result._id || result.result.id;
				wx.showModal({ title: '上次提交已保存', content: '请查看该订单后再继续，当前填写的内容会保留。', confirmText: '查看订单', cancelText: '留在此页',
					success: res => { if (res.confirm) wx.navigateTo({ url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(id)) }); } });
			} else wx.showModal({ title: '上次提交未保存', content: '已停止上次未完成的提交，可以继续提交当前内容。', showCancel: false });
		} catch (e) { Ops.error(e); }
		finally { this._submitting = false; this.setData({ submitting: false }); }
	},

	resetAfterPublish: function () {
		const end = Deadline.after();
		const old = this.data.mailValues || {};
		const campus = this.data.campus || '';
		const mailValues = { code: '', address2: old.address2 || '', poster: old.poster || '', tel: old.tel || '', tel2: '', desc: '' };
		const form = this.selectComponent('#cmpt-form');
		if (form && form.data && Array.isArray(form.data.forms) && typeof form.setOneFormVal === 'function') {
			const values = { title: '快递代取', num: 1, weight: 1, price: this.data.packageTypes && this.data.packageTypes[0] ? this.data.packageTypes[0].price : '1.50', code: '', img: [], address2: mailValues.address2, poster: mailValues.poster, tel: mailValues.tel, tel2: mailValues.tel2, desc: '', small: 1, medium: 0, large: 0, urgent: false, campus, formEnd: end, packages: [] };
			form.data.forms.forEach(item => form.setOneFormVal(item.mark, Object.prototype.hasOwnProperty.call(values, item.mark) ? values[item.mark] : (item.type === 'image' ? [] : item.type === 'switch' ? false : '')));
		}
		const packageTypes = (this.data.packageTypes || []).map((item, index) => Object.assign({}, item, { count: index === 0 ? 1 : 0 }));
		this.setData({ editId: '', mailId: '', formEnd: end, formEndFocus: '', mailValues, proofImages: [], proofPreview: {}, packageItems: [], packageTypes, totalCount: 1, totalFee: packageTypes[0] ? packageTypes[0].price : '1.50', urgent: false, campus, campusIndex: Math.max(0, (this.data.campuses || []).indexOf(campus)) });
		this._syncPackageItems([]);
		this.bindClosePackagePickup();
		this._refreshFee();
	},
	_showMailList: function () { PublicBiz.removeCacheList('admin-mail-list');
		PublicBiz.removeCacheList('mail-list');
		PublicBiz.removeCacheList('order-mail-take');
		PublicBiz.removeCacheList('order-mail-posted');
		PublicBiz.removeCacheList('order-mail-mine');
		PublicBiz.removeCacheList('order-mail-done');
		if (this.data.embedded) { this.triggerEvent('published', { id: this.data.mailId }); return; }
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
  this._submitting=true;this.setData({submitting:true});
  try {
   if(!await PassportBiz.loginMustCancelWin(this))return;
   const packages = Array.isArray(this.data.packageItems) ? this.data.packageItems : [];
   if (!packages.length) throw new Error('请先选择包裹');
   const missingPickup = packages.findIndex(item => !String(item.pickupPoint || '').trim());
   if (missingPickup >= 0) throw new Error('请选择第' + (missingPickup + 1) + '件包裹的取件点');
   let data=validate.check(this.data,MailBiz.CHECK_FORM,this);if(!data)return;
   const form=this.selectComponent('#cmpt-form');if(!form)return;
   // Sync the complete visible address before validating the hidden form snapshot.
   const address2 = String(this.data.mailValues && this.data.mailValues.address2 || '').trim();
   const addressPhase = Address.phaseOf({ detail: address2 });
   form.setOneFormVal('address2',address2);
   const current=form.getForms(true);if(!current)return;
   wx.showLoading({title:'上传并保存中',mask:true});
   const hasPackageProof = packages.some(item => item.code || item.images && item.images.length);
   const forms=JSON.parse(JSON.stringify(current)).filter(x=>!['campus','formEnd','packages','address1','address2','addressPhase'].includes(x.mark) && (!hasPackageProof || !['code','img'].includes(x.mark)));
   // Submit the visible destination directly even if the component still returns an older value.
   forms.push({mark:'address2',title:'收件地址',type:'textarea',val:address2});
   if(addressPhase)forms.push({mark:'addressPhase',title:'所属期数',type:'text',val:addressPhase});
    const packageRows = await this._uploadPackageImages((Array.isArray(this.data.packageItems) ? this.data.packageItems : []).map(({_used,...item})=>item));
    forms.push({mark:'packages',title:'逐件凭证',type:'json',val:packageRows});
   for(const item of forms)if(item.type==='image')item.val=await Ops.upload(item.val||[]);
   forms.push({mark:'campus',title:'校区',type:'text',val:this.data.campus});
   if(data.end)forms.push({mark:'formEnd',title:'接单截止时间',type:'date',val:data.end});
   const params={forms,cateId:data.cateId,price:String(this.data.totalFee)};if(this.data.editId)params.id=this.data.editId;
   const result=await Ops.command(this.data.editId?'mail/edit':'mail/insert',params);
   this.setData({mailId:result._id||result.id});wx.hideLoading();PublicBiz.removeCacheList('mail-list');
   wx.showModal({title:this.data.editId?'保存成功':'发布成功',content:this.data.config.offlineNotice,showCancel:false,success:()=>this._showMailList()});
  }catch(e){wx.hideLoading();Ops.error(e);}finally{this._submitting=false;this.setData({submitting:false});this._refreshPendingSubmission();}
 },
};
