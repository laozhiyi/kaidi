const Ops = require('../../biz/operations_biz.js');
const cloudHelper = require('../../../../helper/cloud_helper.js');
const validate = require('../../../../helper/validate.js');
const pageHelper = require('../../../../helper/page_helper.js');
const projectSetting = require('../../public/project_setting.js');
const ProfileBiz = require('../../biz/profile_biz.js');
const Address = require('../../biz/address_biz.js');
const PassportBiz = require('../../../../comm/biz/passport_biz.js');
const InviteBiz = require('../../biz/invite_biz.js');
const Tenant = require('../../biz/tenant_biz.js');
const academicDirectory = require('../../public/academic_directory.js');
const collegeNames = Object.keys(academicDirectory);
const fixedCampus = projectSetting.PUBLIC_PROFILE_CAMPUS;
const PERSONAL_MARKS = new Set(['sex', 'college', 'sub', 'studentId', 'studentCard', 'disclaimer']);
const STUDENT_ID_RE = /^[A-Za-z0-9]{6,20}$/;
let campusCache = null;
let campusRequest = null;
let campusCacheVersion = 0;
let manualRegistrationAllowed = false;
let phoneLoginEnabled = false;
let profilePhoneRequired = false;
const REQUEST_TIMEOUT = 12000;
const PROFILE_CACHE_TTL = 30000;
const DISK_CACHE_TTL = 6 * 60 * 60 * 1000;
const CAMPUS_CACHE_KEY = 'crun-profile-campuses-v4';
const PROFILE_CACHE_KEY = 'crun-profile-user-v1';
const scopeKey = () => Ops.scopeKey ? Ops.scopeKey() : '';
const sessionEpoch = () => cloudHelper.getSessionEpoch ? cloudHelper.getSessionEpoch() : PassportBiz.logoutEpoch ? PassportBiz.logoutEpoch() : 0;
let cacheScope = '';
function checkScope() {
  const next = scopeKey();
  if (next !== cacheScope) {
    cacheScope = next; campusCacheVersion++; campusCache=null; campusRequest=null; manualRegistrationAllowed=false; phoneLoginEnabled=false; profilePhoneRequired=false;
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
    canChooseWechatAvatar: supportsNative('button.open-type.chooseAvatar'), canUseWechatNickname: supportsNative('input.type.nickname'),
    profileCampusFixed: !!fixedCampus, ...(fixedCampus ? { campus: fixedCampus } : {}) });
}
function applyRegistrationPolicy(page, allowed, phoneEnabled = page.data.phoneLoginEnabled, required = page.data.profilePhoneRequired) {
  if (page._unloaded) return;
  phoneEnabled = required !== true && phoneEnabled === true;
  allowed = required !== true && (!phoneEnabled || allowed === true);
  page.setData({ phoneLoginEnabled: phoneEnabled, allowManualRegistration: allowed, profilePhoneRequired: required === true });
}
function isProfileReady(user) {
  return !!(user && user.USER_PROFILE_COMPLETE === true && (user.USER_MOBILE_VERIFIED === true || user.profilePhoneRequired !== true && user.allowManualRegistration === true));
}
async function loadCampuses(page, force = false, { notifyFailure = true } = {}) {
  checkScope();
  const requestScope = scopeKey(), version = campusCacheVersion;
  if (!campusCache) {
    const saved = readDiskCache(CAMPUS_CACHE_KEY, 'shared');
    if (saved && Array.isArray(saved.campuses) && saved.locations && (!fixedCampus || saved.campuses.includes(fixedCampus))) {
      campusCache = fixedCampus ? [fixedCampus] : saved.campuses;
      manualRegistrationAllowed = saved.allowManualRegistration === true;
      phoneLoginEnabled = saved.phoneLoginEnabled === true; profilePhoneRequired = saved.profilePhoneRequired === true; Address.configure(saved.locations);
    }
  }
  if (!force && campusCache) {
    if (!page._unloaded) {
      page.setData({ campuses: campusCache, addressPhaseOptions:Address.PHASES.slice(), placeGroups: Address.placeGroups() });
      applyRegistrationPolicy(page, manualRegistrationAllowed, phoneLoginEnabled, profilePhoneRequired);
    }
    return campusCache;
  }
  if (!campusRequest) {
    const pending = withTimeout(Ops.get('operations/config')).then(config => {
      const values = config && Array.isArray(config.campuses) ? config.campuses : [];
      const names = Array.from(new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())));
      const campuses = fixedCampus ? names.filter(name => name === fixedCampus) : names;
      if (!campuses.length) throw new Error('校区配置尚未完成，请稍后重试');
      if (version === campusCacheVersion && requestScope === scopeKey()) {
        Address.configure(config.locations || {phases:[],pickupStations:[]});
        campusCache = campuses;
        manualRegistrationAllowed = config.allowManualRegistration === true;
        phoneLoginEnabled = config.phoneLoginEnabled === true;
        profilePhoneRequired = config.profilePhoneRequired === true;
        writeDiskCache(CAMPUS_CACHE_KEY, {campuses, allowManualRegistration:manualRegistrationAllowed, phoneLoginEnabled, profilePhoneRequired, locations:config.locations || {phases:[],pickupStations:[]}}, 'shared');
      }
      return { campuses, allowManualRegistration: config.allowManualRegistration === true, phoneLoginEnabled: config.phoneLoginEnabled === true, profilePhoneRequired: config.profilePhoneRequired === true };
    }).finally(() => { if (campusRequest === pending) campusRequest = null; });
    campusRequest = pending;
  }
  try {
    const { campuses, allowManualRegistration, phoneLoginEnabled, profilePhoneRequired } = await campusRequest;
    if (requestScope !== scopeKey() || version !== campusCacheVersion) return [];
    if (!page._unloaded) {
      page.setData({ campuses, campusError:'', addressPhaseOptions:Address.PHASES.slice(), placeGroups: Address.placeGroups() });
      applyRegistrationPolicy(page, allowManualRegistration, phoneLoginEnabled, profilePhoneRequired);
    }
    return campuses;
  } catch (error) {
    if (!page._unloaded && requestScope === scopeKey() && version === campusCacheVersion) {
      page.setData({ campuses:[], addressPhaseOptions:[], campusError:error.message || '校区加载失败' });
      applyRegistrationPolicy(page, false);
      if (notifyFailure) pageHelper.showNoneToast(error.message || '校区加载失败，请重试');
    }
    return [];
  }
}
function majorsForCollege(college) {
  return collegeNames.includes(college) ? academicDirectory[college] : [];
}

function normalizeCollege(name) {
  const label = name.trim().replace(/\s*[/／]\s*/g, '／');
  if (collegeNames.includes(label)) return label;
  const matches = collegeNames.filter(college => college.split('／').includes(label));
  return matches.length === 1 ? matches[0] : name.trim();
}

function applyUser(page, user) {
  if (typeof user.allowManualRegistration === 'boolean' || typeof user.phoneLoginEnabled === 'boolean' || typeof user.profilePhoneRequired === 'boolean') {
    applyRegistrationPolicy(page, typeof user.allowManualRegistration === 'boolean' ? user.allowManualRegistration : page.data.allowManualRegistration,
      typeof user.phoneLoginEnabled === 'boolean' ? user.phoneLoginEnabled : page.data.phoneLoginEnabled,
      typeof user.profilePhoneRequired === 'boolean' ? user.profilePhoneRequired : page.data.profilePhoneRequired);
  }
  if (page._profileDirty || page.data.campusPickerVisible || page.data.educationPicker || page.data.contactEditorVisible || page.data.addressEditorVisible || page.data.collectionSaving) return;
  const p = ProfileBiz.readProfile(user);
  const campuses = page.data.campuses || [];
  const campus = fixedCampus || p.campus;
  const forms = Array.isArray(user.USER_FORMS) ? user.USER_FORMS : [];
  const college = normalizeCollege(String(ProfileBiz.formValue(forms, 'college') || ''));
  const savedMajor = String(ProfileBiz.formValue(forms, 'sub') || '').trim();
  const cleanMajor = savedMajor.split(/[（(]/, 1)[0].trim();
  const major = majorsForCollege(college).includes(cleanMajor) ? cleanMajor : savedMajor;
  page.setData(Object.assign({ phoneVerified: user.USER_MOBILE_VERIFIED === true, accountStatus: typeof user.USER_STATUS === 'number' ? user.USER_STATUS : -1, formName: user.USER_NAME || '', formMobile: user.USER_MOBILE || '', formPic: user.USER_PIC || '', formForms: forms, fields: projectSetting.USER_FIELDS, genderOptions: ['男', '女'], profileSex: String(ProfileBiz.formValue(forms, 'sex') || ''), profileCollege: college, profileSub: major,
    originalProfileCollege: college, originalProfileMajor: major, profileMajorManual: false,
    profileStudentId: String(ProfileBiz.formValue(forms, 'studentId') || ''), studentProofLocked: user.studentProofLocked === true,
    profileStudentCard: [].concat(ProfileBiz.formValue(forms, 'studentCard') || []).filter(value => typeof value === 'string' && value).slice(0, 1),
    profileDisclaimer: ProfileBiz.formValue(forms, 'disclaimer') === true }, p, {
    campuses, campus, campusIndex: campuses.indexOf(campus), campusPickerVisible: false, campusDraft: '', contactEditorVisible: false, addressEditorVisible: false, placePickerVisible: false, placeDraft: '', editingContactIndex: -1, editingAddressIndex: -1, contactDraft: { name: '', phone: '' }, addressDraft: { label: '', detail: '', note: '' }
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
  if (this.data.profilePhoneRequired || this.data.phoneLoginEnabled === true && (this.data.phoneVerified || !this.data.allowManualRegistration)) return;
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
  if (!(this.data.profilePhoneRequired || this.data.phoneLoginEnabled) || profileBusy(this)) return;
  // The native button still needs to open its sheet; do not disable it on tap.
  PassportBiz.traceWechatPhoneTap();
}
async function bindWechatPhone(e) {
  if (!(this.data.profilePhoneRequired || this.data.phoneLoginEnabled) || profileBusy(this)) return;
  const verifying = this.data.profilePhoneRequired === true;
  const requestScope = scopeKey(), epoch = sessionEpoch();
  const isCurrent = () => !this._unloaded && (!verifying || requestScope === scopeKey() && epoch === sessionEpoch());
  this.setData({ phoneAuthorizing: true, saveError: '' });
  try {
    const result = verifying ? await PassportBiz.verifyProfilePhone(e) : await PassportBiz.loginByWechatPhone(e);
    invalidateProfileCache();
    if (!isCurrent()) return;
    if (!result.user || result.user.USER_MOBILE_VERIFIED !== true) throw new Error('手机号授权未完成，请重试');
    // Keep unsaved edits to all other fields when rebinding the phone.
    this.setData({ formMobile: result.user.USER_MOBILE, phoneVerified: true });
    this._profileDirty = true;
  } catch (error) {
    if (isCurrent()) {
      const message = error && (error.msg || error.message) || '手机号授权失败，请重试';
      this.setData({ saveError: message }); pageHelper.showNoneToast(message);
    }
  } finally { if (!this._unloaded) this.setData({ phoneAuthorizing: false }); }
}
async function bindOpenCampusPicker() {
  if (this.data.saving || this.data.campusPickerVisible) return;
  const campuses = this.data.campuses || [];
  if (!campuses.length && !fixedCampus) return pageHelper.showNoneToast('校区加载中，请稍后重试');
  const names = fixedCampus ? [fixedCampus] : campuses;
  const retryDirectory = this.data.campusDirectoryError === true;
  this.setData({ campusPickerVisible: true, campusDraft: campuses.includes(this.data.campus) ? this.data.campus : '',
    campusOptions: names.map(name => ({ name, selectable: campuses.includes(name) })), campusDirectoryError: false, campusDirectoryLoading: !!fixedCampus });
  if (wx.hideKeyboard) wx.hideKeyboard();
  if (!fixedCampus) return;
  try {
    const directory = await Tenant.directory(() => withTimeout(Ops.get('tenant/catalog')), retryDirectory);
    if (this._unloaded || !this.data.campusPickerVisible) return;
    const current = directory.campuses.find(row => row.name === fixedCampus && row.selectable === true)
      || directory.campuses.find(row => row.name === fixedCampus);
    if (!current) throw new Error('校区目录暂不可用');
    const otherNames = directory.campuses.filter(row => row.schoolId === current.schoolId && row.name && row.name !== fixedCampus).map(row => row.name);
    this.setData({ campusOptions: [fixedCampus, ...new Set(otherNames)].map(name => ({
      name, selectable: name === fixedCampus && (this.data.campuses || []).includes(name)
    })) });
  } catch (error) {
    if (!this._unloaded && this.data.campusPickerVisible) this.setData({ campusDirectoryError: true });
  } finally {
    if (!this._unloaded && this.data.campusPickerVisible) this.setData({ campusDirectoryLoading: false });
  }
}
function bindSelectCampus(e) {
  const value = e.currentTarget.dataset.value;
  if ((!fixedCampus || value === fixedCampus) && (this.data.campuses || []).includes(value)) this.setData({ campusDraft: value });
}
function bindConfirmCampus() {
  const { campusDraft } = this.data;
  const campusIndex = (this.data.campuses || []).indexOf(campusDraft);
  if (campusIndex < 0 || fixedCampus && campusDraft !== fixedCampus) return pageHelper.showNoneToast('请选择所在校区');
  this._profileDirty = true;
  this.setData({ campus: campusDraft, campusIndex, campusPickerVisible: false, campusDraft: '' });
}
function bindCloseCampusPicker() { this.setData({ campusPickerVisible: false, campusDraft: '' }); }
function bindProfileSheetTouchMove() {}
function bindCampusChange(e) {
  if (fixedCampus) return;
  const i = Number(e.detail.value);
  if (!Number.isInteger(i) || !(this.data.campuses || [])[i]) return;
  this._profileDirty = true;
  this.setData({ campusIndex: i, campus: this.data.campuses[i] });
}
function bindGenderTap(e) { this._profileDirty = true; this.setData({ profileSex: e.currentTarget.dataset.value || '' }); }
function educationOptions(kind, college) {
  return kind === 'college' ? collegeNames : majorsForCollege(college);
}
function bindOpenEducationPicker(e) {
  if (profileBusy(this) || this.data.campusPickerVisible) return;
  const kind = e.currentTarget.dataset.kind;
  if (kind !== 'college' && kind !== 'major') return;
  if (kind === 'major' && !this.data.profileCollege) return pageHelper.showNoneToast('请先选择学院');
  this.setData({ educationPicker: kind, educationSearch: '', educationOptions: educationOptions(kind, this.data.profileCollege) });
}
function bindCloseEducationPicker() {
  this.setData({ educationPicker: '', educationSearch: '', educationOptions: [] });
}
function bindEducationSearch(e) {
  const { educationPicker, profileCollege } = this.data;
  if (!educationPicker) return;
  const value = e.detail.value;
  const query = value.trim().replace(/\s*[/／]\s*/g, '／').toLowerCase();
  const matches = educationOptions(educationPicker, profileCollege).filter(name => name.toLowerCase().includes(query));
  this.setData({ educationSearch: value, educationOptions: matches });
}
function bindSelectEducation(e) {
  const { educationPicker, profileCollege, profileSub, profileMajorManual } = this.data;
  const value = e.currentTarget.dataset.value;
  if (!educationPicker || !educationOptions(educationPicker, profileCollege).includes(value)) return;
  if (educationPicker === 'college' && value !== profileCollege) {
    this._profileDirty = true;
    this.setData({ profileCollege: value, profileSub: majorsForCollege(value).includes(profileSub) ? profileSub : '', profileMajorManual: false });
  } else if (educationPicker === 'major' && (value !== profileSub || profileMajorManual)) {
    this._profileDirty = true;
    this.setData({ profileSub: value, profileMajorManual: false });
  }
  this.bindCloseEducationPicker();
}
function bindEnterMajorManually() {
  if (this.data.educationPicker !== 'major' || !this.data.profileCollege) return;
  this._profileDirty = true;
  this.setData({ profileMajorManual: true });
  this.bindCloseEducationPicker();
}
function bindProfileFieldInput(e) {
  if (profileBusy(this)) return;
  const field = e.currentTarget.dataset.field;
  if (field === 'profileStudentId' ? this.data.studentProofLocked : field !== 'profileSub' || !this.data.profileMajorManual) return;
  this._profileDirty = true;
  this.setData({ [field]: e.detail.value });
}
function bindDisclaimerTap() {
  if (profileBusy(this)) return;
  this._profileDirty = true; this.setData({ profileDisclaimer: !this.data.profileDisclaimer });
}
function bindViewDisclaimer() {
  wx.navigateTo({ url: '/projects/crun/pages/about/index/about_index?key=SETUP_CONTENT_DISCLAIMER' });
}
function bindChooseStudentCard() {
  if (profileBusy(this) || this.data.studentProofLocked) return;
  const success = result => {
    const file = result.tempFiles && result.tempFiles[0];
    const path = file && file.tempFilePath || result.tempFilePaths && result.tempFilePaths[0];
    if (profileBusy(this) || this.data.studentProofLocked || !path) return;
    this._profileDirty = true; this.setData({ profileStudentCard: [path] });
  };
  const fail = error => { if (!this._unloaded && !/cancel/i.test(error && error.errMsg || '')) pageHelper.showNoneToast('图片选择失败，请重试'); };
  if (typeof wx.chooseMedia === 'function' && supportsNative('chooseMedia')) wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success, fail });
  else if (typeof wx.chooseImage === 'function') wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success, fail });
  else pageHelper.showNoneToast('当前微信无法选择图片，请更新微信后重试');
}
function bindPreviewStudentCard() {
  const url = (this.data.profileStudentCard || [])[0];
  if (url) wx.previewImage({ current: url, urls: [url] });
}
function bindDeleteStudentCard() {
  if (profileBusy(this) || this.data.studentProofLocked) return;
  this._profileDirty = true; this.setData({ profileStudentCard: [] });
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
  campusCacheVersion++; campusCache = null; campusRequest = null; manualRegistrationAllowed = false; phoneLoginEnabled = false; profilePhoneRequired = false;
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
  this.setData({ addressEditorVisible: true, editingAddressIndex: -1, placePickerVisible: false, placeDraft: '', addressDraft: { label: '', detail: '', note: '' } });
}
function bindEditAddress(e) {
  if (this.data.collectionSaving) return;
  const index = itemIndex(e, this.data.addresses || []);
  if (index >= 0) {
    const saved = this.data.addresses[index];
    this.setData({ addressEditorVisible: true, editingAddressIndex: index, placePickerVisible: false, placeDraft: '', addressDraft: { ...saved, label: Address.initialPlace(saved) } });
  }
}
// 地点用底部弹层选择：上半部分是宿舍区（一期~五期），下半部分是地图上的其余地点。
function bindOpenPlacePicker() {
  if (this.data.collectionSaving) return;
  if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  this.setData({ placePickerVisible: true, placeDraft: this.data.addressDraft.label || '' });
}
function bindSelectPlace(e) {
  if (this.data.collectionSaving) return;
  const label = e.currentTarget.dataset.label;
  if (Address.validPlace(label)) this.setData({ placeDraft: label });
}
function bindConfirmPlace() {
  if (this.data.collectionSaving) return;
  this.setData({ 'addressDraft.label': this.data.placeDraft || '', placePickerVisible: false, placeDraft: '' });
}
function bindClearPlace() {
  if (!this.data.collectionSaving) this.setData({ placeDraft: '' });
}
function bindClosePlacePicker() {
  if (!this.data.collectionSaving) this.setData({ placePickerVisible: false, placeDraft: '' });
}
function bindPlaceSheetStop() { }
function bindSetDefaultAddress(e) {
  const index = itemIndex(e, this.data.addresses || []);
  if (index < 0) return;
  return saveCollections(this, { addresses: this.data.addresses.map((item, i) => ({ ...item, isDefault: i === index })) });
}
function bindDeleteAddress(e) {
  const index = itemIndex(e, this.data.addresses || []);
  if (index < 0) return;
  const editing = this.data.editingAddressIndex;
  const editor = editing === index ? { addressEditorVisible: false, editingAddressIndex: -1, addressDraft: { label: '', detail: '', note: '' } }
    : editing > index ? { editingAddressIndex: editing - 1 } : {};
  return saveCollections(this, { addresses: this.data.addresses.filter((_, i) => i !== index) }, editor);
}
function bindCancelAddress() {
  if (!this.data.collectionSaving) this.setData({ addressEditorVisible: false, editingAddressIndex: -1, placePickerVisible: false, placeDraft: '', addressDraft: { label: '', detail: '', note: '' }, saveError: '' });
}
function bindSaveAddress() {
  if (this.data.collectionSaving) return;
  const draft = this.data.addressDraft || {};
  const item = { label: String(draft.label || '').trim(), detail: String(draft.detail || '').trim(), note: Array.from(String(draft.note || '').trim()).slice(0, 60).join('') };
  // 地点是选填项：没选就按详细地址送达，只有填了才需要在可选范围内。
  if (item.label && !Address.validPlace(item.label)) return pageHelper.showNoneToast('所选地点不在可选范围内');
  if (!item.detail) return pageHelper.showNoneToast('请填写详细地址');
  const addresses = (this.data.addresses || []).slice(), index = this.data.editingAddressIndex;
  if (index >= 0 && index < addresses.length) addresses[index] = { ...addresses[index], ...item };
  else addresses.push(item);
  return saveCollections(this, { addresses }, { addressEditorVisible: false, editingAddressIndex: -1, placePickerVisible: false, placeDraft: '', addressDraft: { label: '', detail: '', note: '' } });
}
function finishProfile(page) {
  const myPage = '/projects/crun/pages/my/index/my_index';
  const { accountStatus, returnToPublish } = page.data;
  if (accountStatus !== undefined && accountStatus !== 1 && !(accountStatus === 0 && returnToPublish)) return wx.switchTab({ url: myPage });
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
// 邀请码：注册页与资料页共用这一套逻辑与 personal_form.wxml 里的字段。
const INVITE_CODE_RE = /^[A-Z0-9]{6}$/;
function bindInviteCodeInput(e) {
  this.setData({ inviteCode: InviteBiz.normalize(String(e.detail.value || '').replace(/[^A-Za-z0-9]/g, '')) });
}
async function loadInviteInfo(page) {
  let info = null;
  try { info = await cloudHelper.callCloudData('invite/my_info', {}, { hint: false }); } catch (_) { /* 加载失败只是不显示邀请码区块内容，不影响资料编辑。 */ }
  if (!info || page._unloaded) return;
  page.setData({ myInviteCode: info.code || '', inviteBound: info.bound === true, inviteBoundCode: info.boundCode || '' });
  if (info.bound) InviteBiz.clear();
}
function bindCopyMyInviteCode() {
  if (!this.data.myInviteCode) return;
  wx.setClipboardData({ data: this.data.myInviteCode, success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
    fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
}
function showInviteFailure(reason) {
  return new Promise(resolve => wx.showModal({ title: '资料已保存', content: '邀请码未绑定：' + reason, showCancel: false, success: resolve, fail: resolve }));
}
async function bindSubmitTap(e) {
  if (profileBusy(this) || this.data.educationPicker) return;
  readSubmittedNickname(this, e);
  const userId = PassportBiz.getUserId(), requestScope = scopeKey(), epoch = sessionEpoch();
  const isCurrent = () => !this._unloaded && !PassportBiz.isLoggedOut() && PassportBiz.getUserId() === userId && requestScope === scopeKey() && epoch === sessionEpoch();
  this.setData({ saving: true, saveError: '' });
  try {
    if (!PassportBiz.getUserId()) throw new Error('请先点击微信登录');
    if ((this.data.profilePhoneRequired || this.data.phoneLoginEnabled === true && !this.data.allowManualRegistration) && this.data.phoneVerified !== true) throw new Error('请先验证联系电话');
    if (!/^1[3-9][0-9]{9}$/.test(this.data.formMobile || '')) throw new Error('请填写正确的手机号');
    if (!(this.data.campuses || []).includes(this.data.campus) || fixedCampus && this.data.campus !== fixedCampus) throw new Error('请选择所在校区');
    if (!['男', '女'].includes(this.data.profileSex)) throw new Error('请选择性别');
    const college = String(this.data.profileCollege || '').trim();
    const major = String(this.data.profileSub || '').trim();
    const keepsCollege = this.data.isEdit && college === this.data.originalProfileCollege;
    if (!college || !collegeNames.includes(college) && !keepsCollege) throw new Error('请选择所在学院');
    if (!major || major.length > 80) throw new Error('请选择或填写所学专业（最多80字）');
    const keepsMajor = college === this.data.originalProfileCollege && major === this.data.originalProfileMajor;
    if (!this.data.profileMajorManual && !majorsForCollege(college).includes(major) && !keepsMajor) {
      throw new Error('请选择该学院的专业，或手动填写');
    }
    const studentId = String(this.data.profileStudentId || '').trim();
    // Required on first registration; legacy accounts may leave it empty when editing.
    if (!this.data.isEdit || studentId) {
      if (!STUDENT_ID_RE.test(studentId)) throw new Error(studentId ? '学号为6-20位字母或数字' : '请填写学号');
    }
    const studentCard = (this.data.profileStudentCard || []).filter(value => typeof value === 'string' && value);
    if (!this.data.isEdit && !studentCard.length) throw new Error('请上传学生证照片');
    if (!this.data.isEdit && this.data.profileDisclaimer !== true) throw new Error('请阅读并同意免责声明');
    // 已绑定过邀请人的账号不能再改；其余情况（注册 / 资料编辑）填了就提交。
    const inviteCode = this.data.inviteBound ? '' : InviteBiz.normalize(this.data.inviteCode);
    if (inviteCode && !INVITE_CODE_RE.test(inviteCode)) throw new Error('邀请码为6位大写字母或数字');
    const personal = [
      { mark: 'sex', title: '性别', type: 'select', val: this.data.profileSex },
      { mark: 'college', title: '学院', type: 'text', val: college },
      { mark: 'sub', title: '专业', type: 'text', val: major }
    ];
    if (studentId) personal.push({ mark: 'studentId', title: '学号', type: 'text', val: studentId });
    if ((this.data.profileStudentCard || []).length) personal.push({ mark: 'studentCard', title: '学生证', type: 'image', val: this.data.profileStudentCard.slice(0, 1) });
    if (this.data.profileDisclaimer === true) personal.push({ mark: 'disclaimer', title: '免责声明', type: 'bool', val: true });
    const contacts = ProfileBiz.normalizeContacts(this.data.contacts), addresses = ProfileBiz.normalizeAddresses(this.data.addresses);
    const forms = collectionForms(this, contacts, addresses).filter(item => !PERSONAL_MARKS.has(item.mark) && item.mark !== 'campus').concat(personal);
    forms.push({ mark: 'campus', title: '所在校区', type: 'select', val: this.data.campus });
    const data = validate.check({ ...this.data, formForms: forms }, projectSetting.USER_CHECK_FORM, this);
    if (!data) return;
    const pic = await cloudHelper.transTempPicOne(this.data.formPic, 'user/', '', false);
    if (!isCurrent()) return;
    for (const item of forms) if (item.type === 'image' && Array.isArray(item.val)) {
      item.val = this.data.profilePhoneRequired && item.mark === 'studentCard' && item.val.some(path => !path.startsWith('cloud://'))
        ? await Ops.upload(item.val) : await cloudHelper.transTempPics(item.val, 'user/');
    }
    if (!isCurrent()) return;
    const isRegister = !this.data.isEdit;
    const result = await withTimeout(cloudHelper.callCloudSumbit(isRegister ? 'passport/register' : 'passport/edit_base', {
      name: this.data.formName, mobile: this.data.formMobile, pic, forms,
      // 邀请码随注册一起提交，由服务端在注册事务后立即绑定，避免中途丢失。
      inviteCode: isRegister ? inviteCode : ''
    }, { title: '保存中' }));
    if (!isCurrent()) return;
    let message = this.data.isEdit ? '保存成功' : '资料已完善';
    const token = result && result.data && result.data.token;
    if (!this.data.isEdit) {
      if (!token || !token.id || !PassportBiz.isProfileReady(token)) throw new Error('资料状态暂未同步，请刷新重试');
      if (token.status !== 1) message = '资料已提交，等待审核';
    }
    if (token) { PassportBiz.setToken(token); this.setData({ accountStatus: token.status }); }
    // 资料已经保存成功；邀请码的结果单独处理，任何失败都只提示、不回滚资料。
    let inviteFailure = '';
    if (inviteCode) {
      if (isRegister) {
        // 注册时服务端已经在资料落库后尝试绑定，结果随 invite 字段返回。
        const invite = result && result.data && result.data.invite;
        if (invite) { if (!invite.accepted) inviteFailure = invite.reason || '邀请码未能绑定'; InviteBiz.clear(); }
        else {
          // 兼容没有返回 invite 字段的响应：沿用客户端绑定，失败时保留暂存等下次重试。
          InviteBiz.capture(inviteCode);
          if (token.status === 1) try {
            const accepted = await InviteBiz.acceptPending(inviteCode);
            if (accepted && !accepted.accepted) inviteFailure = accepted.reason || '邀请码未能绑定';
          } catch (_) { /* 保留邀请码，下次进入个人中心时重试绑定。 */ }
        }
      } else {
        try {
          const accepted = await InviteBiz.acceptPending(inviteCode);
          if (accepted && accepted.accepted) this.setData({ inviteBound: true, inviteBoundCode: inviteCode, inviteCode: '' });
          else inviteFailure = accepted && accepted.reason || '邀请码未能绑定';
        } catch (_) { inviteFailure = '网络异常，邀请码稍后会自动重试绑定'; }
      }
    }
    if (inviteFailure && isCurrent()) await showInviteFailure(inviteFailure);
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
module.exports = { initProfileCapabilities, applyRegistrationPolicy, isProfileReady, loadCampuses, getCachedProfileUser, getProfileUser, invalidateProfileCache, clearLocalCaches, applyUser, finishProfile, bindProfileNameInput, bindProfileMobileInput, bindPicTap, bindChooseAvatar, bindWechatPhoneTap, bindWechatPhone, bindCampusChange, bindOpenCampusPicker, bindSelectCampus, bindConfirmCampus, bindCloseCampusPicker, bindProfileSheetTouchMove, bindGenderTap, bindOpenEducationPicker, bindCloseEducationPicker, bindEducationSearch, bindSelectEducation, bindEnterMajorManually, bindProfileFieldInput, bindDisclaimerTap, bindViewDisclaimer, bindChooseStudentCard, bindPreviewStudentCard, bindDeleteStudentCard, bindContactInput, bindAddressInput, bindOpenPlacePicker, bindSelectPlace, bindConfirmPlace, bindClearPlace, bindClosePlacePicker, bindPlaceSheetStop, bindAddContact, bindEditContact, bindSetDefaultContact, bindDeleteContact, bindCancelContact, bindSaveContact, bindAddAddress, bindEditAddress, bindSetDefaultAddress, bindDeleteAddress, bindCancelAddress, bindSaveAddress, bindSaveWechatProfile, bindSubmitTap, bindInviteCodeInput, bindCopyMyInviteCode, loadInviteInfo };
