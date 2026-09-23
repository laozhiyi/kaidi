const Ops = require('../../biz/operations_biz.js');
const cloudHelper = require('../../../../helper/cloud_helper.js');
const validate = require('../../../../helper/validate.js');
const pageHelper = require('../../../../helper/page_helper.js');
const projectSetting = require('../../public/project_setting.js');
const ProfileBiz = require('../../biz/profile_biz.js');
const Address = require('../../biz/address_biz.js');
const PassportBiz = require('../../../../comm/biz/passport_biz.js');
const InviteBiz = require('../../biz/invite_biz.js');
const DEFAULT_CAMPUSES = [];
const PERSONAL_MARKS = new Set(['sex', 'college', 'sub']);
let campusCache = null;
let campusRequest = null;
let campusCacheVersion = 0;
let manualRegistrationAllowed = false;
let phoneLoginEnabled = false;
const REQUEST_TIMEOUT = 12000;
const PROFILE_CACHE_TTL = 30000;
const DISK_CACHE_TTL = 6 * 60 * 60 * 1000;
const CAMPUS_CACHE_KEY = 'crun-profile-campuses-v1';
const PROFILE_CACHE_KEY = 'crun-profile-user-v1';
const scopeKey = () => Ops.scopeKey ? Ops.scopeKey() : '';
const sessionEpoch = () => cloudHelper.getSessionEpoch ? cloudHelper.getSessionEpoch() : PassportBiz.logoutEpoch ? PassportBiz.logoutEpoch() : 0;
let cacheScope = '';
function checkScope() {
  const next = scopeKey();
  if (next !== cacheScope) {
    cacheScope = next; campusCacheVersion++; campusCache=null; campusRequest=null; manualRegistrationAllowed=false; phoneLoginEnabled=false;
    profileCacheVersion++; profileCache=null; profileRequest=null; profileCacheUserId=''; profileCachedAt=0;
    Address.configure({phases:[],pickupStations:[]});
  }
}
let profileCache = null;
let profileCachedAt = 0;
let profileRequest = null;
let profileCacheUserId = '';
let profileCacheVersion = 0;
function withTimeout(promise, ms = REQUEST_TIMEOUT) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时，请检查网络后重试')), ms);
  })]).finally(() => clearTimeout(timer));
}
function readDiskCache(key, userId) { try { const saved = wx.getStorageSync(key + ':' + (userId || 'guest') + ':' + scopeKey()); return saved && saved.value && Date.now() - saved.savedAt < DISK_CACHE_TTL ? saved.value : null; } catch (_) { return null; } }
function writeDiskCache(key, value, userId) { try { wx.setStorageSync(key + ':' + (userId || 'guest') + ':' + scopeKey(), { savedAt: Date.now(), value }); } catch (_) {} }
function supportsNative(capability) {
  try { return typeof wx.canIUse !== 'function' || wx.canIUse(capability); } catch (_) { return false; }
}
function initProfileCapabilities(page) {
  page.setData({ canGetWechatPhone: supportsNative('button.open-type.getPhoneNumber'),
    canChooseWechatAvatar: supportsNative('button.open-type.chooseAvatar'), canUseWechatNickname: supportsNative('input.type.nickname') });
}
function applyRegistrationPolicy(page, allowed, phoneEnabled = page.data.phoneLoginEnabled) {
  if (page._unloaded) return;
  phoneEnabled = phoneEnabled === true;
  allowed = !phoneEnabled || allowed === true;
  page.setData({ phoneLoginEnabled: phoneEnabled, allowManualRegistration: allowed });
}
function isProfileReady(user) {
  return !!(user && user.USER_PROFILE_COMPLETE === true && (user.USER_MOBILE_VERIFIED === true || user.allowManualRegistration === true));
}
async function loadCampuses(page, force = false) {
  checkScope();
  const requestScope = scopeKey(), version = campusCacheVersion;
  if (!campusCache) {
    const saved = readDiskCache(CAMPUS_CACHE_KEY, 'shared');
    if (saved && Array.isArray(saved.campuses) && saved.locations) {
      campusCache = saved.campuses; manualRegistrationAllowed = saved.allowManualRegistration === true;
      phoneLoginEnabled = saved.phoneLoginEnabled === true; Address.configure(saved.locations);
    }
  }
  if (!force && campusCache) {
    if (!page._unloaded) {
      page.setData({ campuses: campusCache, addressPhaseOptions:Address.PHASES.slice() });
      applyRegistrationPolicy(page, manualRegistrationAllowed, phoneLoginEnabled);
    }
    return campusCache;
  }
  if (!campusRequest) {
    const pending = withTimeout(Ops.get('operations/config')).then(config => {
      const values = config && Array.isArray(config.campuses) ? config.campuses : [];
      const clean = Array.from(new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())));
      if (!clean.length) throw new Error('校区配置尚未完成，请稍后重试');
      const campuses = clean;
      if (version === campusCacheVersion && requestScope === scopeKey()) {
        Address.configure(config.locations || {phases:[],pickupStations:[]});
        campusCache = campuses;
        manualRegistrationAllowed = config.allowManualRegistration === true;
        phoneLoginEnabled = config.phoneLoginEnabled === true;
        writeDiskCache(CAMPUS_CACHE_KEY, {campuses, allowManualRegistration:manualRegistrationAllowed, phoneLoginEnabled, locations:config.locations || {phases:[],pickupStations:[]}}, 'shared');
      }
      return { campuses, allowManualRegistration: config.allowManualRegistration === true, phoneLoginEnabled: config.phoneLoginEnabled === true };
    }).finally(() => { if (campusRequest === pending) campusRequest = null; });
    campusRequest = pending;
  }
  try {
    const { campuses, allowManualRegistration, phoneLoginEnabled } = await campusRequest;
    if (requestScope !== scopeKey() || version !== campusCacheVersion) return [];
    if (!page._unloaded) {
      page.setData({ campuses, campusError:'', addressPhaseOptions:Address.PHASES.slice() });
      applyRegistrationPolicy(page, allowManualRegistration, phoneLoginEnabled);
    }
    return campuses;
  } catch (error) {
    if (!page._unloaded && requestScope === scopeKey() && version === campusCacheVersion) {
      page.setData({ campuses:[], addressPhaseOptions:[], campusError:error.message || '校区加载失败' });
      applyRegistrationPolicy(page, false);
      pageHelper.showNoneToast(error.message || '校区加载失败，请重试');
    }
    return [];
  }
}
function applyUser(page, user) {
  if (typeof user.allowManualRegistration === 'boolean' || typeof user.phoneLoginEnabled === 'boolean') {
    applyRegistrationPolicy(page, typeof user.allowManualRegistration === 'boolean' ? user.allowManualRegistration : page.data.allowManualRegistration,
      typeof user.phoneLoginEnabled === 'boolean' ? user.phoneLoginEnabled : page.data.phoneLoginEnabled);
  }
  if (page._profileDirty || page.data.campusPickerVisible || page.data.contactEditorVisible || page.data.addressEditorVisible || page.data.collectionSaving) return;
  const p = ProfileBiz.readProfile(user);
  const campuses = page.data.campuses && page.data.campuses.length ? page.data.campuses : DEFAULT_CAMPUSES;
  const forms = Array.isArray(user.USER_FORMS) ? user.USER_FORMS : [];
  page.setData(Object.assign({ phoneVerified: user.USER_MOBILE_VERIFIED === true, accountStatus: typeof user.USER_STATUS === 'number' ? user.USER_STATUS : -1, formName: user.USER_NAME || '', formMobile: user.USER_MOBILE || '', formPic: user.USER_PIC || '', formForms: forms, fields: projectSetting.USER_FIELDS, genderOptions: ['男', '女'], profileSex: String(ProfileBiz.formValue(forms, 'sex') || ''), profileCollege: String(ProfileBiz.formValue(forms, 'college') || ''), profileSub: String(ProfileBiz.formValue(forms, 'sub') || '') }, p, {
    campuses, campusIndex: campuses.indexOf(p.campus), campusPickerVisible: false, campusDraft: '', contactEditorVisible: false, addressEditorVisible: false, editingContactIndex: -1, editingAddressIndex: -1, contactDraft: { name: '', phone: '' }, addressDraft: { label: '', detail: '' }
  }));
}
function profileBusy(page) {
  return page._unloaded || page.data.saving || page.data.phoneAuthorizing || page.data.identityLoggingIn || page.data.collectionSaving || page.data.loggingOut || page.data.cancellingAccount;
}
function bindProfileNameInput(e) {
  if (profileBusy(this)) return;
  this._profileDirty = true; this.setData({ formName: e.detail.value });
}
function readSubmittedNickname(page, e) {
  const values = e && e.detail && e.detail.value;
  if (values && Object.prototype.hasOwnProperty.call(values, 'nickname')) {
    // Native security checks can clear the input after bindinput/bindblur.
    page._profileDirty = true;
    page.setData({ formName: typeof values.nickname === 'string' ? values.nickname : '' });
  }
}
function bindPicTap(e) {
  if (profileBusy(this) || PassportBiz.isLoggedOut() && !this.data.wechatProfileVisible) return;
  const pic = e && e.detail && e.detail.avatarUrl;
  if (typeof pic !== 'string' || !pic.trim()) return;
  this._profileDirty = true; this.setData({ formPic: pic });
}
function bindProfileMobileInput(e) {
  if (this.data.phoneLoginEnabled === true && (this.data.phoneVerified || !this.data.allowManualRegistration)) return;
  this._profileDirty = true; this.setData({ formMobile: e.detail.value });
}
function bindChooseAvatar() {
  if (profileBusy(this) || PassportBiz.isLoggedOut() && !this.data.wechatProfileVisible) return;
  const epoch = sessionEpoch();
  const success = result => {
    const file = result.tempFiles && result.tempFiles[0];
    const path = file && file.tempFilePath || result.tempFilePaths && result.tempFilePaths[0];
    if (profileBusy(this) || PassportBiz.isLoggedOut() && !this.data.wechatProfileVisible || !path
      || epoch !== sessionEpoch()) return;
    this._profileDirty = true; this.setData({ formPic: path });
  };
  const fail = error => { if (!this._unloaded && !/cancel/i.test(error && error.errMsg || '')) pageHelper.showNoneToast('头像选择失败，请重试'); };
  if (typeof wx.chooseMedia === 'function' && supportsNative('chooseMedia')) wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success, fail });
  else if (typeof wx.chooseImage === 'function') wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success, fail });
  else pageHelper.showNoneToast('当前微信无法选择图片，请更新微信后重试');
}
function bindWechatPhoneTap() {
  if (this.data.phoneLoginEnabled !== true || this.data.phoneAuthorizing || this.data.saving || this.data.collectionSaving || this.data.loggingOut) return;
  // The native button still needs to open its sheet; do not disable it on tap.
  PassportBiz.traceWechatPhoneTap();
}
async function bindWechatPhone(e) {
  if (this.data.phoneLoginEnabled !== true || this.data.phoneAuthorizing || this.data.saving || this.data.collectionSaving || this.data.loggingOut) return;
  this.setData({ phoneAuthorizing: true, saveError: '' });
  try {
    const result = await PassportBiz.loginByWechatPhone(e);
    invalidateProfileCache();
    if (this._unloaded) return;
    if (!result.user || result.user.USER_MOBILE_VERIFIED !== true) throw new Error('手机号授权未完成，请重试');
    // Keep unsaved edits to all other fields when rebinding the phone.
    this.setData({ formMobile: result.user.USER_MOBILE, phoneVerified: true });
    this._profileDirty = true;
  } catch (error) {
    if (!this._unloaded) {
      const message = error && (error.msg || error.message) || '手机号授权失败，请重试';
      this.setData({ saveError: message }); pageHelper.showNoneToast(message);
    }
  } finally { if (!this._unloaded) this.setData({ phoneAuthorizing: false }); }
}
function bindOpenCampusPicker() {
  if (this.data.saving) return;
  const campuses = this.data.campuses || [];
  if (!campuses.length) return pageHelper.showNoneToast('校区加载中，请稍后重试');
  this.setData({ campusPickerVisible: true, campusDraft: campuses.includes(this.data.campus) ? this.data.campus : '' });
  if (wx.hideKeyboard) wx.hideKeyboard();
}
function bindSelectCampus(e) {
  const value = e.currentTarget.dataset.value;
  if ((this.data.campuses || []).includes(value)) this.setData({ campusDraft: value });
}
function bindConfirmCampus() {
  const campusIndex = (this.data.campuses || []).indexOf(this.data.campusDraft);
  if (campusIndex < 0) return pageHelper.showNoneToast('请选择所在校区');
  this._profileDirty = true;
  this.setData({ campus: this.data.campusDraft, campusIndex, campusPickerVisible: false, campusDraft: '' });
}
function bindCloseCampusPicker() { this.setData({ campusPickerVisible: false, campusDraft: '' }); }
function bindProfileSheetTouchMove() {}
function bindCampusChange(e) {
  const i = Number(e.detail.value);
  if (!Number.isInteger(i) || !(this.data.campuses || [])[i]) return;
  this._profileDirty = true;
  this.setData({ campusIndex: i, campus: this.data.campuses[i] });
}
function bindGenderTap(e) { this._profileDirty = true; this.setData({ profileSex: e.currentTarget.dataset.value || '' }); }
function bindProfileFieldInput(e) {
  const field = e.currentTarget.dataset.field;
  if (!['profileCollege', 'profileSub'].includes(field)) return;
  this._profileDirty = true;
  this.setData({ [field]: e.detail.value });
}
function getCachedProfileUser() { checkScope(); const userId = PassportBiz.getUserId(); return userId ? readDiskCache(PROFILE_CACHE_KEY, userId) : null; }
function getProfileUser(options, force = false) {
  if (PassportBiz.isLoggedOut()) return Promise.resolve(null);
  checkScope();
  const userId = PassportBiz.getUserId();
  if (!userId) return Promise.resolve(null);
  if (!force && profileCache && profileCacheUserId === userId && Date.now() - profileCachedAt < PROFILE_CACHE_TTL) return Promise.resolve(profileCache);
  if (!force && profileRequest && profileRequest.userId === userId) return profileRequest.promise;
  const pending = { userId, version: profileCacheVersion, scope: scopeKey(), sessionEpoch: sessionEpoch() };
  pending.promise = withTimeout(cloudHelper.callCloudSumbit('passport/my_detail', {}, options || { title: 'bar' })).then(response => {
    if (PassportBiz.isLoggedOut() || pending.version !== profileCacheVersion || pending.sessionEpoch !== sessionEpoch()) return null;
    const data = response && response.data;
    const user = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length ? data : null;
    if (pending.scope !== scopeKey()) throw new Error('校区已切换，请重新加载个人资料');
    if (pending.version === profileCacheVersion && PassportBiz.getUserId() === userId) {
      profileCache = user || null; profileCacheUserId = userId; profileCachedAt = Date.now();
      if (user && userId) writeDiskCache(PROFILE_CACHE_KEY, user, userId);
    }
    return user;
  }).finally(() => { if (profileRequest === pending) profileRequest = null; });
  profileRequest = pending;
  return pending.promise;
}
function invalidateProfileCache() {
  profileCacheVersion++; profileCache = null; profileCachedAt = 0; profileCacheUserId = ''; profileRequest = null;
  try { const userId = PassportBiz.getUserId(); if (userId) wx.removeStorageSync(PROFILE_CACHE_KEY + ':' + userId + ':' + scopeKey()); } catch (_) {}
}
function clearLocalCaches() {
  campusCacheVersion++; campusCache = null; campusRequest = null; manualRegistrationAllowed = false; phoneLoginEnabled = false;
  invalidateProfileCache();
  for (const key of wx.getStorageInfoSync().keys) {
    if (key.startsWith(CAMPUS_CACHE_KEY + ':') || key.startsWith(PROFILE_CACHE_KEY + ':')) wx.removeStorageSync(key);
  }
  if (Ops.clearUploadCache) Ops.clearUploadCache();
}
if (cloudHelper.onSessionChange) cloudHelper.onSessionChange(invalidateProfileCache);
function bindContactInput(e) { if (!this.data.collectionSaving) this.setData({ ['contactDraft.' + e.currentTarget.dataset.field]: e.detail.value }); }
function bindAddressInput(e) { if (!this.data.collectionSaving) this.setData({ ['addressDraft.' + e.currentTarget.dataset.field]: e.detail.value }); }
function itemIndex(e, list) {
  const index = Number(e.currentTarget.dataset.index);
  return Number.isInteger(index) && index >= 0 && index < list.length ? index : -1;
}
function collectionForms(page, contacts, addresses) {
  const forms = (page.data.formForms || []).filter(item => item && !['contacts', 'addresses', 'address', 'commonContact', 'commonContactMobile'].includes(item.mark));
  forms.push(
    { mark: 'contacts', title: '常用联系人', type: 'json', val: contacts },
    { mark: 'addresses', title: '常用地址', type: 'json', val: addresses },
    { mark: 'address', title: '常用地址', type: 'text', val: Address.formatAddress(ProfileBiz.getDefaultItem(addresses)) },
    { mark: 'commonContact', title: '常用联系人', type: 'text', val: (ProfileBiz.getDefaultItem(contacts) || {}).name || '' },
    { mark: 'commonContactMobile', title: '联系人手机', type: 'text', val: (ProfileBiz.getDefaultItem(contacts) || {}).phone || '' }
  );
  return forms;
}
async function saveCollections(page, patch, closeEditor = {}) {
  if (profileBusy(page) || !PassportBiz.getUserId()) return false;
  const userId = PassportBiz.getUserId(), requestScope = scopeKey(), epoch = sessionEpoch();
  const isCurrent = () => !page._unloaded && !PassportBiz.isLoggedOut() && PassportBiz.getUserId() === userId && scopeKey() === requestScope
    && epoch === sessionEpoch();
  const contacts = ProfileBiz.normalizeContacts(patch.contacts || page.data.contacts);
  const addresses = ProfileBiz.normalizeAddresses(patch.addresses || page.data.addresses);
  const forms = collectionForms(page, contacts, addresses);
  page.setData({ collectionSaving: true, saveError: '' });
  try {
    await withTimeout(cloudHelper.callCloudSumbit('passport/edit_base', {
      name: page.data.formName || '', mobile: page.data.formMobile || '', pic: page.data.formPic || '', forms
    }, { title: '保存中' }));
    if (!isCurrent()) return false;
    invalidateProfileCache();
    page._profileDirty = true;
    if (!page._unloaded) page.setData({ contacts, addresses, formForms: forms, ...closeEditor });
    return true;
  } catch (error) {
    const message = error && (error.msg || error.message) || '保存失败，请重试';
    if (isCurrent()) { page.setData({ saveError: message }); pageHelper.showNoneToast(message); }
    return false;
  } finally { if (!page._unloaded) page.setData({ collectionSaving: false }); }
}
function bindAddContact() {
  if (this.data.collectionSaving) return;
  this.setData({ contactEditorVisible: true, editingContactIndex: -1, contactDraft: { name: '', phone: '' } });
}
function bindEditContact(e) {
  if (this.data.collectionSaving) return;
  const index = itemIndex(e, this.data.contacts || []);
  if (index >= 0) this.setData({ contactEditorVisible: true, editingContactIndex: index, contactDraft: { ...this.data.contacts[index] } });
}
function bindSetDefaultContact(e) {
  const index = itemIndex(e, this.data.contacts || []);
  if (index < 0) return;
  return saveCollections(this, { contacts: this.data.contacts.map((item, i) => ({ ...item, isDefault: i === index })) });
}
function bindDeleteContact(e) {
  const index = itemIndex(e, this.data.contacts || []);
  if (index < 0) return;
  const editing = this.data.editingContactIndex;
  const editor = editing === index ? { contactEditorVisible: false, editingContactIndex: -1, contactDraft: { name: '', phone: '' } }
    : editing > index ? { editingContactIndex: editing - 1 } : {};
  return saveCollections(this, { contacts: this.data.contacts.filter((_, i) => i !== index) }, editor);
}
function bindCancelContact() {
  if (!this.data.collectionSaving) this.setData({ contactEditorVisible: false, editingContactIndex: -1, contactDraft: { name: '', phone: '' }, saveError: '' });
}
function bindSaveContact() {
  if (this.data.collectionSaving) return;
  const draft = this.data.contactDraft || {};
  const item = { name: String(draft.name || '').trim(), phone: String(draft.phone || '').trim() };
  if (!item.name || !/^1[3-9]\d{9}$/.test(item.phone)) return pageHelper.showNoneToast('请填写正确的联系人和手机号');
  const contacts = (this.data.contacts || []).slice(), index = this.data.editingContactIndex;
  if (index >= 0 && index < contacts.length) contacts[index] = { ...contacts[index], ...item };
  else contacts.push(item);
  return saveCollections(this, { contacts }, { contactEditorVisible: false, editingContactIndex: -1, contactDraft: { name: '', phone: '' } });
}
function bindAddAddress() {
  if (this.data.collectionSaving) return;
  this.setData({ addressEditorVisible: true, editingAddressIndex: -1, addressDraft: { label: '', detail: '' } });
}
function bindEditAddress(e) {
  if (this.data.collectionSaving) return;
  const index = itemIndex(e, this.data.addresses || []);
  if (index >= 0) this.setData({ addressEditorVisible: true, editingAddressIndex: index, addressDraft: { ...this.data.addresses[index], label: Address.phaseOf(this.data.addresses[index]) } });
}
function bindAddressPhase(e) {
  const phase = e.currentTarget.dataset.phase;
  if (!this.data.collectionSaving && Address.PHASES.includes(phase)) this.setData({ 'addressDraft.label': phase });
}
function bindSetDefaultAddress(e) {
  const index = itemIndex(e, this.data.addresses || []);
  if (index < 0) return;
  return saveCollections(this, { addresses: this.data.addresses.map((item, i) => ({ ...item, isDefault: i === index })) });
}
function bindDeleteAddress(e) {
  const index = itemIndex(e, this.data.addresses || []);
  if (index < 0) return;
  const editing = this.data.editingAddressIndex;
  const editor = editing === index ? { addressEditorVisible: false, editingAddressIndex: -1, addressDraft: { label: '', detail: '' } }
    : editing > index ? { editingAddressIndex: editing - 1 } : {};
  return saveCollections(this, { addresses: this.data.addresses.filter((_, i) => i !== index) }, editor);
}
function bindCancelAddress() {
  if (!this.data.collectionSaving) this.setData({ addressEditorVisible: false, editingAddressIndex: -1, addressDraft: { label: '', detail: '' }, saveError: '' });
}
function bindSaveAddress() {
  if (this.data.collectionSaving) return;
  const draft = this.data.addressDraft || {};
  const item = { label: String(draft.label || '').trim(), detail: String(draft.detail || '').trim() };
  if (!Address.PHASES.includes(item.label)) return pageHelper.showNoneToast('请选择地址所属期数');
  if (!item.detail) return pageHelper.showNoneToast('请填写详细地址');
  const addresses = (this.data.addresses || []).slice(), index = this.data.editingAddressIndex;
  if (index >= 0 && index < addresses.length) addresses[index] = { ...addresses[index], ...item };
  else addresses.push(item);
  return saveCollections(this, { addresses }, { addressEditorVisible: false, editingAddressIndex: -1, addressDraft: { label: '', detail: '' } });
}
function finishProfile(page) {
  const myPage = '/projects/crun/pages/my/index/my_index';
  if (page.data.accountStatus !== undefined && page.data.accountStatus !== 1) return wx.switchTab({ url: myPage });
  const returnUrl = page.data.retUrl;
  if (returnUrl === 'back' && getCurrentPages().length > 1) return wx.navigateBack();
  if (returnUrl && returnUrl !== 'back') {
    const tabs = [myPage, '/projects/crun/pages/default/index/default_index', '/projects/crun/pages/order/index/order_index'];
    if (tabs.includes(returnUrl.split('?')[0])) return wx.switchTab({ url: returnUrl.split('?')[0] });
    return wx.redirectTo({ url: returnUrl, fail: () => wx.switchTab({ url: myPage }) });
  }
  wx.switchTab({ url: myPage });
}
async function bindSaveWechatProfile(e, options = {}) {
  if (profileBusy(this)) return;
  readSubmittedNickname(this, e);
  const userId = PassportBiz.getUserId(), requestScope = scopeKey(), epoch = sessionEpoch();
  const isCurrent = () => !this._unloaded && !PassportBiz.isLoggedOut() && !!userId && PassportBiz.getUserId() === userId && scopeKey() === requestScope
    && epoch === sessionEpoch();
  this.setData({ saving: true, saveError: '' });
  try {
    if (!userId) throw new Error('请先点击微信登录');
    const name = String(this.data.formName || '').trim();
    if (!name || name.length > 30) throw new Error('请选择或填写昵称（最多30字）');
    if (!this.data.formPic) throw new Error('请点击选择头像');
    const pic = await withTimeout(cloudHelper.transTempPicOne(this.data.formPic, 'user/', '', false));
    if (!isCurrent()) return;
    if (typeof pic !== 'string' || !/^(?:cloud|https):\/\//.test(pic)) throw new Error('头像上传未完成，请重新选择');
    // Keep the uploaded file for retries if the subsequent save fails.
    this.setData({ formName: name, formPic: pic });
    const result = await withTimeout(cloudHelper.callCloudSumbit('passport/wechat_profile', { name, pic }, { title: '保存中', hint: false }));
    if (!isCurrent()) return;
    const token = result && result.data && result.data.token;
    if (!token || token.id !== userId || ![0, 1, 8].includes(token.status) || !token.name || !token.pic
      || typeof token.profileComplete !== 'boolean' || typeof token.phoneVerified !== 'boolean') throw new Error('资料状态暂未同步，请重试');
    PassportBiz.setToken(token);
    invalidateProfileCache();
    this._profileDirty = false;
    this.setData({ formName: token.name, formPic: token.pic, accountStatus: token.status });
    if (options.stayOnPage) return token;
    pageHelper.showSuccToast('头像和昵称已保存', 1200, () => {
      if (isCurrent()) wx.switchTab({ url: '/projects/crun/pages/my/index/my_index' });
    });
    return token;
  } catch (error) {
    if (!this._unloaded && (!userId || isCurrent())) {
      const message = error && (error.msg || error.message) || '保存失败，请稍后重试';
      this.setData({ saveError: message }); pageHelper.showNoneToast(message);
    }
  } finally { if (!this._unloaded) this.setData({ saving: false }); }
}
async function bindSubmitTap(e) {
  if (profileBusy(this)) return;
  readSubmittedNickname(this, e);
  const userId = PassportBiz.getUserId(), requestScope = scopeKey(), epoch = sessionEpoch();
  const isCurrent = () => !this._unloaded && !PassportBiz.isLoggedOut() && PassportBiz.getUserId() === userId && requestScope === scopeKey() && epoch === sessionEpoch();
  this.setData({ saving: true, saveError: '' });
  try {
    if (!PassportBiz.getUserId()) throw new Error('请先点击微信登录');
    if (this.data.phoneLoginEnabled === true && this.data.phoneVerified !== true && this.data.allowManualRegistration !== true) throw new Error('请先授权微信手机号');
    if (!/^1[3-9][0-9]{9}$/.test(this.data.formMobile || '')) throw new Error('请填写正确的手机号');
    if (!(this.data.campuses || []).includes(this.data.campus)) throw new Error('请选择所在校区');
    if (!['男', '女'].includes(this.data.profileSex)) throw new Error('请选择性别');
    if (!String(this.data.profileCollege || '').trim()) throw new Error('请填写所在学院');
    if (!String(this.data.profileSub || '').trim()) throw new Error('请填写所学专业');
    const inviteCode = this.data.isEdit ? '' : InviteBiz.normalize(this.data.inviteCode);
    if (inviteCode && !/^[A-Z0-9]{6}$/.test(inviteCode)) throw new Error('邀请码为6位字母或数字');
    const personal = [
      { mark: 'sex', title: '性别', type: 'select', val: this.data.profileSex },
      { mark: 'college', title: '学院', type: 'text', val: this.data.profileCollege.trim() },
      { mark: 'sub', title: '专业', type: 'text', val: this.data.profileSub.trim() }
    ];
    const contacts = ProfileBiz.normalizeContacts(this.data.contacts), addresses = ProfileBiz.normalizeAddresses(this.data.addresses);
    const forms = collectionForms(this, contacts, addresses).filter(item => !PERSONAL_MARKS.has(item.mark) && item.mark !== 'campus').concat(personal);
    forms.push({ mark: 'campus', title: '所在校区', type: 'select', val: this.data.campus });
    const data = validate.check({ ...this.data, formForms: forms }, projectSetting.USER_CHECK_FORM, this);
    if (!data) return;
    const pic = await cloudHelper.transTempPicOne(this.data.formPic, 'user/', '', false);
    if (!isCurrent()) return;
    for (const item of forms) if (item.type === 'image' && Array.isArray(item.val)) item.val = await cloudHelper.transTempPics(item.val, 'user/');
    if (!isCurrent()) return;
    const result = await withTimeout(cloudHelper.callCloudSumbit(this.data.isEdit ? 'passport/edit_base' : 'passport/register', {
      name: this.data.formName, mobile: this.data.formMobile, pic, forms
    }, { title: '保存中' }));
    if (!isCurrent()) return;
    let message = this.data.isEdit ? '保存成功' : '资料已完善';
    const token = result && result.data && result.data.token;
    if (!this.data.isEdit) {
      if (!token || !token.id || !PassportBiz.isProfileReady(token)) throw new Error('资料状态暂未同步，请刷新重试');
      if (token.status !== 1) message = '资料已提交，等待审核';
    }
    if (token) { PassportBiz.setToken(token); this.setData({ accountStatus: token.status }); }
    if (!this.data.isEdit) {
      if (inviteCode) {
        InviteBiz.capture(inviteCode);
        if (token.status === 1) try {
          const accepted = await InviteBiz.acceptPending(inviteCode);
          if (accepted && !accepted.accepted) message = '资料已完善，邀请码未绑定';
        } catch (_) { /* 保留邀请码，下次进入个人中心时重试绑定。 */ }
      }
    }
    invalidateProfileCache();
    this._profileDirty = false;
    pageHelper.showSuccToast(message, 1200, () => { if (isCurrent()) finishProfile(this); });
  } catch (error) {
    if (userId && !isCurrent()) return;
    const message = error && (error.msg || error.message) || '保存失败，请稍后重试';
    this.setData({ saveError: message });
    pageHelper.showNoneToast(message);
  } finally { if (!this._unloaded) this.setData({ saving: false }); }
}
module.exports = { initProfileCapabilities, applyRegistrationPolicy, isProfileReady, loadCampuses, getCachedProfileUser, getProfileUser, invalidateProfileCache, clearLocalCaches, applyUser, finishProfile, bindProfileNameInput, bindProfileMobileInput, bindPicTap, bindChooseAvatar, bindWechatPhoneTap, bindWechatPhone, bindCampusChange, bindOpenCampusPicker, bindSelectCampus, bindConfirmCampus, bindCloseCampusPicker, bindProfileSheetTouchMove, bindGenderTap, bindProfileFieldInput, bindContactInput, bindAddressInput, bindAddressPhase, bindAddContact, bindEditContact, bindSetDefaultContact, bindDeleteContact, bindCancelContact, bindSaveContact, bindAddAddress, bindEditAddress, bindSetDefaultAddress, bindDeleteAddress, bindCancelAddress, bindSaveAddress, bindSaveWechatProfile, bindSubmitTap };
