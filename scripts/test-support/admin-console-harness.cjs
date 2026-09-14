'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const mini = path.join(root, 'miniprogram');
function harness(relative, get = () => ({}), options = {}) {
  let definition;
  const calls = [], navigation = [], errors = [], patches = [], scrolls = [], events = [], confirmations = [], sheets = [], cache = {};
  const wx = {
    setNavigationBarColor() {}, setNavigationBarTitle() {}, stopPullDownRefresh() {}, showToast() {}, showLoading() {}, hideLoading() {},
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, previewImage() {}, makePhoneCall() {},
    setClipboardData: data => events.push({ copy: data.data }),
    pageScrollTo: data => scrolls.push(data),
    showModal(data) { confirmations.push(data); if (data.success) data.success({ confirm: options.confirm !== false }); },
    showActionSheet(data) { sheets.push(data); },
    navigateTo: data => { navigation.push({ ...data, method: 'navigateTo' }); if (data.complete) data.complete(); },
    redirectTo: data => { navigation.push({ ...data, method: 'redirectTo' }); if (data.complete) data.complete(); },
    reLaunch: data => navigation.push({ ...data, method: 'reLaunch' }),
    navigateBack: () => navigation.push({ method: 'navigateBack' })
  };
  const Ops = {
    get: async (route, params) => { calls.push({ route, params }); return get(route, params); },
    command: async (route, params) => { calls.push({ route, params, command: true }); return get(route, params); },
    error: error => errors.push(error && (error.msg || error.message) || String(error))
  };
  const Admin = { isAdmin(page, superOnly) { if (options.denied || (superOnly && options.superAdmin === false)) return false; page.setData({ isAdmin: true, isSuperAdmin: options.superAdmin !== false, admin: { name: 'admin', type: options.superAdmin === false ? 0 : 1 } }); return true; }, clearAdminToken() { events.push({ logout: true }); } };
  // Use the production validation rules and content summary helper.
  const adminModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(mini, 'comm/biz/admin_biz.js'), 'utf8'), { module: adminModule, require: request => request.endsWith('/base_biz.js') ? class {} : {} });
  for (const name of ['CHECK_FORM_MGR_ADD', 'CHECK_FORM_MGR_EDIT', 'CHECK_FORM_MGR_PWD', 'setContentDesc']) Admin[name] = adminModule.exports[name];
  const cloud = {
    callCloud: async (route, params) => ({ code: 200, data: await Ops.get(route, params) }),
    callCloudSumbit: async (route, params) => ({ code: 200, data: await Ops.command(route, params) }),
    callCloudData: async (route, params) => Ops.get(route, params),
    transRichEditorTempPics: async (content, folder, id, route) => { await Ops.command(route, { id, content, folder }); return content; },
    transCoverTempPics: async (images, folder, id, route) => Ops.command(route, { id, images, folder }),
    transFormsTempPics: async (forms, folder, id, route) => Ops.command(route, { id, forms, folder })
  };
  const pageHelper = {
    anchor() {},
    model(page, e) { page.setData({ [e.currentTarget.dataset.item]: e.detail.value }); },
    showModal(message) { errors.push(message); },
    showSuccToast(message, duration, callback) { if (callback) callback(); },
    getPrevPage: () => options.parent,
    modifyPrevPageListNodeObject() {},
    url(e) { const data = e.currentTarget.dataset; if (data.type === 'back') wx.navigateBack(); else if (data.url) wx.navigateTo({ url: data.url }); }
  };
  function evaluate(file, page = false) {
    const absolute = path.join(mini, file);
    if (!page && cache[absolute]) return cache[absolute];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, console, wx, Date, setTimeout, clearTimeout,
      getCurrentPages: () => Array(options.stackLength || 1).fill({}),
      Page: value => { definition = value; }, Component: value => { definition = value; },
      require(request) {
        if (request.endsWith('/operations_biz.js')) return Ops;
        if (request.endsWith('/admin_biz.js')) return Admin;
        if (request.endsWith('/cloud_helper.js')) return cloud;
        if (request.endsWith('/page_helper.js')) return pageHelper;
        if (request.endsWith('/cache_helper.js')) return { remove() {}, get() {} };
        if (request.endsWith('/base_biz.js')) return class {};
        if (request.endsWith('/data_helper.js')) return {};
        if (request.endsWith('/public_biz.js')) return { removeCacheList() {}, getRichEditorDesc: (desc, content) => desc || content.filter(item => item.type === 'text').map(item => item.val).join('').slice(0, 100) };
        if (request.endsWith('/file_helper.js')) return { openDoc: (title, url) => events.push({ open: url, title }) };
        if (/\/(?:admin_(?:console|settings|export|catalog|manager_form|news)_biz|news_biz|validate|project_setting|chat_page)\.js$/.test(request)) return evaluate(path.relative(mini, path.resolve(path.dirname(absolute), request)));
        throw new Error('Unexpected dependency: ' + request);
      }
    }, { filename: absolute });
    cache[absolute] = module.exports;
    return module.exports;
  }
  evaluate(relative.startsWith('projects/') ? relative : 'projects/crun/pages/admin/' + relative, true);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(values, callback) {
      patches.push(values);
      for (const [key, value] of Object.entries(values)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
        for (const name of parts.slice(0, -1)) target = target[name] ||= {};
        target[parts.at(-1)] = value;
      }
      if (callback) callback();
    },
    getOpenerEventChannel: () => ({ emit: name => events.push({ emit: name }) }),
    selectComponent: id => options.components && options.components[id]
  };
  if (definition.methods) Object.assign(page, definition.methods);
  return { page, calls, navigation, errors, patches, scrolls, events, confirmations, sheets, UI: evaluate('projects/crun/biz/admin_console_biz.js'), Ops, Admin };
}
module.exports = { harness, root, mini };
