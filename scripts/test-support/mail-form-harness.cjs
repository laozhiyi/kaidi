'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const event = (mark, value) => ({ currentTarget: { dataset: { mark } }, detail: { value } });
const flush = () => new Promise(resolve => setImmediate(resolve));

function setData(patch, callback) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = this.data;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)] = copy(value);
  }
  if (callback) callback();
}

function makeProfile(address = '1栋101室') {
  return { _id: 'profile', USER_NAME: '小林', USER_MOBILE: '13800000000', USER_STATUS: 1,
    USER_FORMS: [
      { mark: 'campus', type: 'text', val: '育才校区' },
      { mark: 'contacts', type: 'json', val: [{ name: '联系人', phone: '13900000000', isDefault: true }] },
      { mark: 'addresses', type: 'json', val: address ? [{ label: '一期', detail: address, isDefault: true }] : [] }
    ] };
}

function harness(options = {}) {
  const modules = new Map(), definitions = new Map(), errors = [], commands = [], modals = [];
  let profile = options.profile === undefined ? makeProfile() : options.profile;
  const config = { enabled: true, paymentMode: 'offline', smallPrice: 1.5, mediumPrice: 3, largePrice: 5,
    maxPackages: 10, campuses: ['育才校区'], enforceBusinessHours: false, offlineNotice: '线下结算',
    locations: { phases: ['一期', '二期'], pickupStations: [{ name: '一期', list: ['菜鸟驿站'] }] } };
  const pageHelper = { dataset: (e, key) => e.currentTarget.dataset[key], anchor() {}, fmtURLByPID: url => '/projects/crun' + url,
    showModal: message => { errors.push(message); return false; }, showNoneToast: message => errors.push(message) };
  const passport = { isLogin: () => !!profile, isLoggedOut: () => false, getUserId: () => 'profile', loginMustBackWin: async () => true, loginMustCancelWin: async () => true };
  const cloud = {
    callCloudData: async route => {
      if (route !== 'passport/my_detail') throw Error('Unexpected read: ' + route);
      return options.readProfile ? options.readProfile() : copy(profile);
    },
    callCloudSumbit: async (route, params) => {
      if (route === 'mail/view') return { data: copy(options.mail) };
      if (route === 'passport/my_detail') return { data: copy(profile) };
      if (route === 'passport/edit_base') { profile = { ...profile, USER_FORMS: copy(params.forms) }; return { data: {} }; }
      throw Error('Unexpected submit: ' + route);
    }
  };
  const wx = { setNavigationBarTitle() {}, hideKeyboard() {}, showLoading() {}, hideLoading() {}, showToast() {},
    showModal: data => modals.push(data), stopPullDownRefresh() {}, navigateTo() {}, redirectTo() {},
    getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} };
  const stubs = {
    'miniprogram/helper/page_helper.js': pageHelper,
    'miniprogram/helper/cloud_helper.js': cloud,
    'miniprogram/helper/cache_helper.js': { get() {}, set() {}, remove() {} },
    'miniprogram/projects/crun/biz/project_biz.js': { initPage() {} },
    'miniprogram/comm/biz/passport_biz.js': passport,
    'miniprogram/comm/biz/public_biz.js': { removeCacheList() {} },
    'miniprogram/projects/crun/biz/tenant_biz.js': { current: () => ({ schoolId: 'school', campusId: 'campus' }) },
    'miniprogram/projects/crun/biz/operations_biz.js': {
      get: async () => copy(config), pendingCommand: () => null, error: error => errors.push(error.message),
      upload: async images => images, command: async (route, params) => {
        commands.push({ route, params: copy(params) }); return { _id: 'order-' + commands.length };
      }
    }
  };
  const context = vm.createContext({ wx, console: { log() {}, warn: (...args) => errors.push(args), error: (...args) => errors.push(args) },
    setTimeout, clearTimeout, getApp: () => ({ globalData: {} }) });
  function load(relative) {
    const file = path.resolve(root, relative), key = path.relative(root, file).replaceAll('\\', '/');
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const wrapper = vm.runInContext('(function(require,module,exports,Component,Page){\n' + fs.readFileSync(file, 'utf8') + '\n})', context, { filename: file });
    wrapper(name => load(path.relative(root, path.resolve(path.dirname(file), name))), module, module.exports,
      definition => definitions.set(file, definition), definition => definitions.set(file, definition));
    return module.exports;
  }
  function definition(file) { load(file); return definitions.get(path.resolve(root, file)); }
  function instance(def, props = {}) {
    const defaults = Object.fromEntries(Object.entries(def.properties || {}).map(([name, value]) => [name, copy(value.value)]));
    return { ...(def.methods || def), data: { ...defaults, ...copy(def.data), ...copy(props) }, setData, triggerEvent() {} };
  }
  const formDef = definition('miniprogram/cmpts/public/form/form_show/form_show_cmpt.js');
  function form(fields, forms) {
    const result = instance(formDef, { fields, forms, isCacheMatch: false, isConfirm: false });
    formDef.lifetimes.ready.call(result);
    return result;
  }
  const embedded = options.embedded === true;
  const pageDef = definition('miniprogram/projects/crun/pages/mail/add/' + (embedded ? 'mail_add_embedded' : 'mail_add') + '.js');
  const page = instance(pageDef, { service: options.service || 'take' });
  let engine = null;
  page.selectComponent = () => engine;
  page.setData = function (patch, callback) {
    setData.call(this, patch);
    if (engine) {
      // WXML forwards each parent property independently. It does not call reload().
      if (Object.prototype.hasOwnProperty.call(patch, 'formForms')) engine.data.forms = copy(this.data.formForms);
      if (Object.prototype.hasOwnProperty.call(patch, 'fields')) engine.data.fields = copy(this.data.fields);
    } else if (this.data.isLoad) engine = form(this.data.fields, this.data.formForms);
    if (callback) callback();
  };
  return { page, form, load, instance, config, wx, errors, commands, modals, get engine() { return engine; },
    setProfile(value) { profile = copy(value); },
    getProfile() { return copy(profile); },
    async start() {
      if (embedded) { pageDef.lifetimes.attached.call(page); await flush(); }
      else await page.onLoad(options.mail ? { id: options.mail._id } : { service: options.service });
    },
    async show() {
      if (embedded) { pageDef.pageLifetimes.show.call(page); await flush(); }
      else await page.onShow();
    }
  };
}
module.exports = { harness, makeProfile, copy, event, flush };
