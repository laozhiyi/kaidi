const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProfileBiz = require('../../../biz/profile_biz.js');
const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

const CACHE_KEY = 'crun-home-quick-drafts';
const DEFAULT_SERVICE = 'take';
function formValue(forms, mark) { const item = (forms || []).find(x => x && x.mark === mark); return item && item.val != null ? String(item.val) : ''; }
function dateTimeAfter(days) { const d = new Date(Date.now() + days * 86400000); const pad = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function dateOnly(value) { return String(value || '').slice(0, 10); }
function timeOnly(value) { return String(value || '').slice(11, 16); }

Page({
  data: {
    isLoad: false, activeService: '', referencePrice: '1.50', quickSubmitting: false, today: dateOnly(new Date().toISOString()),
    serviceOptions: [
      { key: 'take', title: '帮我取', desc: '快递代取', icon: 'mail' },
      { key: 'send', title: '帮我送', desc: '同校配送', icon: 'deliver' },
      { key: 'buy', title: '帮我买', desc: '代购所需物品', icon: 'shop' },
    ],
    quickForm: { campus: '', address1: '', address2: '', code: '', poster: '', tel: '', price: '1.50', formEnd: '', formEndDate: '', formEndTime: '', desc: '' },
    quickDrafts: {},
  },
  onLoad() { ProjectBiz.initPage(this); this._restoreQuickForm(); },
  onShow() { const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null; if (tabBar) tabBar.setData({ selected: 0 }); this._loadList(); this._loadProfileDefaults(); },
  _cacheKey() { const userId = PassportBiz.getUserId && PassportBiz.getUserId(); return CACHE_KEY + ':' + (userId || 'guest'); },
  _restoreQuickForm() { const cached = wx.getStorageSync(this._cacheKey()); const drafts = cached && cached.drafts && typeof cached.drafts === 'object' ? cached.drafts : {}; const form = Object.assign({}, this.data.quickForm, drafts[DEFAULT_SERVICE] || (cached && !cached.drafts ? cached : {})); if (!form.formEnd) form.formEnd = dateTimeAfter(3); form.formEndDate = dateOnly(form.formEnd); form.formEndTime = form.formEndTime || timeOnly(form.formEnd) || '18:00'; this.setData({ quickForm: form, quickDrafts: drafts }); },
  async _loadProfileDefaults() { try { if (!PassportBiz.isLogin()) return; const user = await cloudHelper.callCloudData('passport/my_detail', {}, { hint: false }); const profile = ProfileBiz.readProfile(user); const next = Object.assign({}, this.data.quickForm); if (!next.campus) next.campus = profile.campus; if (!next.address2) next.address2 = profile.address2; if (!next.poster) next.poster = profile.poster; if (!next.tel) next.tel = profile.tel; this.setData({ quickForm: next }); this._cacheQuickForm(next); } catch (e) { console.warn('[home] profile defaults unavailable', e); } },
  async _loadList() { try { const res = await cloudHelper.callCloudSumbit('home/list', {}, { title: 'bar' }); const data = res && res.data ? res.data : { list: [], cnt: 0 }; if (typeof data.cnt === 'undefined') data.cnt = (data.list || []).length; let referencePrice = this.data.referencePrice; try { const config = await Ops.get('operations/config'); if (config && Number.isFinite(Number(config.smallPrice))) referencePrice = Number(config.smallPrice).toFixed(2); } catch (_) {} this.setData(Object.assign({}, data, { isLoad: true, referencePrice })); } catch (err) { console.error('加载首页列表失败', err); this.setData({ isLoad: true, cnt: 0 }); } },
  _cacheQuickForm(form, serviceKey = this.data.activeService || DEFAULT_SERVICE) { const drafts = Object.assign({}, this.data.quickDrafts, { [serviceKey]: form }); this.setData({ quickDrafts: drafts }); wx.setStorageSync(this._cacheKey(), { drafts }); },
  bindServiceTap(e) { if (this.data.quickSubmitting) return; const key = e.currentTarget.dataset.key; if (this.data.activeService === key) { this.setData({ activeService: '' }); return; } const draft = this.data.quickDrafts[key] || this.data.quickForm; this.setData({ activeService: key, quickForm: Object.assign({}, this.data.quickForm, draft) }); },
  bindCloseService() { if (this.data.quickSubmitting) return; this.setData({ activeService: '' }); },
  bindQuickInput(e) { const mark = e.currentTarget.dataset.mark; const quickForm = Object.assign({}, this.data.quickForm, { [mark]: e.detail.value }); this.setData({ quickForm }); this._cacheQuickForm(quickForm); },
  bindQuickEndChange(e) { const date = e.detail.value; const time = this.data.quickForm.formEndTime || timeOnly(this.data.quickForm.formEnd) || '18:00'; const quickForm = Object.assign({}, this.data.quickForm, { formEnd: date + ' ' + time, formEndDate: date, formEndTime: time }); this.setData({ quickForm }); this._cacheQuickForm(quickForm); },
  bindQuickTimeChange(e) { const time = e.detail.value; const date = this.data.quickForm.formEndDate || dateOnly(dateTimeAfter(3)); const quickForm = Object.assign({}, this.data.quickForm, { formEnd: date + ' ' + time, formEndDate: date, formEndTime: time }); this.setData({ quickForm }); this._cacheQuickForm(quickForm); },
  async bindQuickSubmit() {
    if (this.data.quickSubmitting) return;
    const serviceKey = this.data.activeService || DEFAULT_SERVICE;
    const f = this.data.quickForm;
    if (!f.campus || !f.address1 || !f.address2 || !f.poster || !/^1[3-9]\d{9}$/.test(f.tel) || !f.code) { wx.showToast({ title: '请完善校区、取件点、地址和联系人信息', icon: 'none' }); return; }
    if (!f.formEnd) { wx.showToast({ title: '请选择期望接单截止时间', icon: 'none' }); return; }
    if (!await PassportBiz.loginMustCancelWin(this)) return;
    this.setData({ quickSubmitting: true });
    try {
      const price = Number(f.price) > 0 ? Number(f.price).toFixed(2) : this.data.referencePrice;
      await Ops.command('mail/insert', { cateId: '1', price, forms: [
        { mark: 'title', title: '任务名称', type: 'text', val: serviceKey === 'send' ? '帮我送' : serviceKey === 'buy' ? '帮我买' : '快递代取' }, { mark: 'num', title: '快递件数', type: 'int', val: 1 }, { mark: 'weight', title: '预估重量(kg)', type: 'int', val: 1 },
        { mark: 'small', title: '小件', type: 'int', val: 1 }, { mark: 'medium', title: '中件', type: 'int', val: 0 }, { mark: 'large', title: '大件', type: 'int', val: 0 },
        { mark: 'price', title: '费用(元)', type: 'digit', val: price }, { mark: 'code', title: '取件码', type: 'text', val: f.code }, { mark: 'img', title: '取件凭证', type: 'image', val: [] },
        { mark: 'address1', title: '取件地址', type: 'text', val: f.address1 }, { mark: 'address2', title: '送达地址', type: 'text', val: f.address2 }, { mark: 'poster', title: '联系人', type: 'text', val: f.poster }, { mark: 'tel', title: '联系人电话', type: 'text', val: f.tel },
        { mark: 'desc', title: '备注', type: 'text', val: f.desc || '' }, { mark: 'urgent', title: '加急', type: 'switch', val: false }, { mark: 'campus', title: '服务校区', type: 'text', val: f.campus }, { mark: 'formEnd', title: '客户期望接单截止时间', type: 'date', val: f.formEnd },
      ] });
      const drafts = Object.assign({}, this.data.quickDrafts); delete drafts[serviceKey]; wx.setStorageSync(this._cacheKey(), { drafts });
      const resetEnd = dateTimeAfter(3); this.setData({ quickDrafts: drafts, quickForm: { campus: f.campus, address1: '', address2: f.address2, code: '', poster: f.poster, tel: f.tel, price: this.data.referencePrice, formEnd: resetEnd, formEndDate: dateOnly(resetEnd), formEndTime: timeOnly(resetEnd), desc: '' }, activeService: '' });
      wx.showToast({ title: '发布成功', icon: 'success' }); this._loadList();
    } catch (e) { Ops.error(e); } finally { this.setData({ quickSubmitting: false }); }
  },
  handleFeatureTap(e) { if (e.currentTarget.dataset.url) this.url(e); },
  url(e) { pageHelper.url(e, this); },
  bindCurTap(e) { this.setData({ cur: pageHelper.dataset(e, 'cur') }); },
  async onPullDownRefresh() { await this._loadList(); wx.stopPullDownRefresh(); },
  onShareAppMessage() {},
  bindEmbeddedPublished() { const form = this.selectComponent('#home-take-form'); if (form && typeof form.resetAfterPublish === 'function') form.resetAfterPublish(); this.setData({ activeService: '' }); wx.showToast({ title: '发布成功', icon: 'success' }); },
  bindExpressTap() { wx.navigateTo({ url: '/projects/crun/pages/mail/add/mail_add' }); },
});
