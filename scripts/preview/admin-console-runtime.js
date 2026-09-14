const root = document.getElementById('admin-console-live-preview');
const host = document.getElementById('ap-page-host');
const pageSelect = document.getElementById('ap-page-select');
const titleNode = document.getElementById('ap-page-title');
const backButton = document.getElementById('ap-back');
const statusNode = document.getElementById('ap-status');
const dialog = document.getElementById('ap-dialog');
const settings = { role: 'super' };
const stack = [], moduleCache = {};
const navPath = '/projects/crun/cmpts/admin_nav/admin_nav';
let pendingRender = false, composing = false, toastTimer, navigating = false;
const current = () => stack[stack.length - 1];
function toast(message) { clearTimeout(toastTimer); statusNode.textContent = message; toastTimer = setTimeout(() => { statusNode.textContent = ''; }, 6000); }
function confirmLocal(options) {
  return new Promise(resolve => {
    document.getElementById('ap-dialog-title').textContent = options.title || '确认操作';
    document.getElementById('ap-dialog-content').textContent = options.content || '';
    document.getElementById('ap-dialog-confirm').textContent = options.confirmText || '确认';
    const finish = confirmed => { dialog.close(); resolve(confirmed); };
    document.getElementById('ap-dialog-confirm').onclick = () => finish(true);
    document.getElementById('ap-dialog-cancel').onclick = () => finish(false);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
}
const wx = {
  setNavigationBarColor() {}, setNavigationBarTitle(options) { titleNode.textContent = options.title; },
  stopPullDownRefresh() {}, pageScrollTo() {},
  enableAlertBeforeUnload(options) { if (current()) current().leaveMessage = options.message; },
  disableAlertBeforeUnload() { if (current()) current().leaveMessage = ''; },
  showToast(options) { toast(options.title); },
  showModal(options) { confirmLocal(options).then(confirm => options.success?.({ confirm, cancel: !confirm })); },
  setClipboardData() { toast('示例内容已选用；正式小程序会复制到剪贴板。'); },
  previewImage() { toast('正式小程序可打开用户提交的凭证图片。'); },
  makePhoneCall() { toast('正式小程序会打开电话拨号界面。'); },
  navigateTo: options => navigateUrl(options, 'push'),
  redirectTo: options => navigateUrl(options, 'replace'),
  navigateBack: () => back(),
  reLaunch() { toast('已演示退出操作，可通过上方选择器继续浏览后台。'); }
};
const Ops = { get: sampleRequest, command: sampleRequest, error: error => toast(error?.msg || error?.message || String(error)) };
const Admin = { isAdmin(page) { page.setData({ isAdmin: true, isSuperAdmin: settings.role === 'super', admin: { name: '运营管理员', type: settings.role === 'super' ? 1 : 0 } }); return true; }, clearAdminToken() {} };
function normalizePath(from, request) {
  const parts = (request.startsWith('/') ? request : from.slice(0, from.lastIndexOf('/') + 1) + request).split('/'), out = [];
  for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
  return '/' + out.join('/');
}
function evaluate(file, definition = false) {
  if (!definition && moduleCache[file]) return moduleCache[file].exports;
  if (!factories[file]) throw new Error('预览缺少模块：' + file);
  const module = { exports: {} }; let result;
  factories[file](module, module.exports, request => {
    if (request.endsWith('/operations_biz.js')) return Ops;
    if (request.endsWith('/admin_biz.js')) return Admin;
    if (request.endsWith('/file_helper.js')) return { openDoc: () => toast('报表操作已演示；Excel 文件在正式小程序中生成和打开。') };
    return evaluate(normalizePath(file, request));
  }, value => { result = value; }, value => { result = value; }, wx, () => stack.map(entry => entry.page));
  if (definition) return result;
  moduleCache[file] = module;
  return module.exports;
}
function patch(target, values) {
  for (const [key, value] of Object.entries(values)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
    cursor[parts.at(-1)] = value;
  }
}
function instance(file, properties = {}, events = {}) {
  const definition = evaluate(file + '.js', true);
  const page = { ...definition, ...definition.methods, data: { ...copySample(definition.data || {}), ...properties },
    setData(values, done) { patch(this.data, values); scheduleRender(); done?.(); },
    getOpenerEventChannel: () => ({ emit: name => events[name]?.() }) };
  return page;
}
function optionsFor(key) { return key === 'order' ? { id: 'sample-order-3' } : key === 'feedbackDetail' ? { id: 'sample-feedback-1' } : key === 'user' ? { id: 'sample-user-3' } : {}; }
async function canLeave() { const entry = current(); return !entry?.leaveMessage || !entry.page.data.dirty || await confirmLocal({ title: '离开当前页面', content: entry.leaveMessage, confirmText: '离开' }); }
async function navigateUrl(options, mode) {
  try {
    const [pathname, query = ''] = options.url.split('?');
    const key = Object.keys(previewPages).find(name => previewPages[name].route === pathname);
    if (!key) { toast('这是小程序中的既有管理页面，本次预览展示 15 个核心页面。'); return; }
    await navigate(key, Object.fromEntries(new URLSearchParams(query)), mode, options.events);
  } catch (error) { Ops.error(error); options.fail?.(error); }
  finally { options.complete?.(); }
}
async function navigate(key, params = optionsFor(key), mode = 'reset', events = {}) {
  if (navigating) return;
  navigating = true;
  pageSelect.disabled = true;
  try {
    if (!await canLeave()) return;
    const old = current(); old?.page.onHide?.();
    if (mode === 'reset') { for (const entry of stack) entry.page.onUnload?.(); stack.length = 0; }
    if (mode === 'replace' && stack.length) stack.pop().page.onUnload?.();
    const page = instance(previewPages[key].route, {}, events);
    stack.push({ key, page, leaveMessage: '' });
    await page.onLoad?.(params); await page.onShow?.();
    render();
  } catch (error) { Ops.error(error); }
  finally { navigating = false; pageSelect.disabled = false; pageSelect.value = current()?.key || 'home'; }
}
async function back() {
  if (stack.length < 2) return navigate('home');
  if (!await canLeave()) return;
  const entry = stack.pop(); entry.page.onHide?.(); entry.page.onUnload?.();
  await current().page.onShow?.(); render();
}
const iconNames = { home: 'layout-dashboard', form: 'clipboard-list', message: 'message-square', group: 'users', settings: 'settings', warn: 'triangle-alert', time: 'clock-3', bar: 'chart-no-axes-combined', service: 'headset', notice: 'megaphone', search: 'search', profile: 'user-round', location: 'map-pin', moneybag: 'wallet', info: 'info', qr_code: 'qr-code', down: 'download', repair: 'wrench', footprint: 'history', lock: 'lock-keyhole', right: 'chevron-right' };
function textContent(node) { if (node === null || node === undefined) return ''; if (typeof node !== 'object') return String(node); return (node.children || []).map(textContent).join(''); }
function fromTree(node, owner, location = '0') {
  if (node === null || node === undefined) return document.createTextNode('');
  if (typeof node !== 'object') return document.createTextNode(String(node));
  const tag = (node.tag || '').replace(/^wx-/, ''), attrs = node.attr || {};
  if (tag === 'admin-nav') {
    const nav = instance(navPath, { active: attrs.active || 'home' });
    return fromTree($gwx('.' + navPath + '.wxml')(nav.data, {}, {}), nav, 'nav');
  }
  if (!tag || tag === 'virtual' || tag === 'block') {
    const fragment = document.createDocumentFragment();
    (node.children || []).forEach((child, index) => fragment.append(fromTree(child, owner, location + '-' + index)));
    return fragment;
  }
  const tap = attrs.bindtap || attrs['bind:tap'] || attrs.catchtap;
  const names = { page: 'div', view: tap ? 'button' : 'div', text: tap ? 'button' : 'span', 'scroll-view': 'div', image: 'img', input: 'input', textarea: 'textarea', switch: 'input', picker: attrs.mode === 'date' ? 'input' : 'select', button: 'button' };
  const element = document.createElement(names[tag] || 'div');
  element.dataset.wxTag = tag;
  if (attrs.class) element.className = attrs.class;
  if (attrs.style) element.setAttribute('style', String(attrs.style).replace(/([\d.]+)rpx/g, (_, n) => Number(n) / 2 + 'px'));
  for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-') || key.startsWith('aria-')) element.setAttribute(key, String(value));
  if (tap) {
    if (tag !== 'button') element.classList.add('ap-hit');
    element.addEventListener('click', event => { event.stopPropagation(); invoke(owner, tap, element, {}); });
  }
  if (element.tagName === 'BUTTON') element.type = 'button';
  if ('disabled' in element) element.disabled = !!attrs.disabled;
  if (attrs.loading) element.setAttribute('aria-busy', 'true');
  if (/\bac-tab\b/.test(attrs.class || '')) element.setAttribute('aria-pressed', String(/\bactive\b/.test(attrs.class)));
  if (tag === 'button' && /\bis-active\b/.test(attrs.class || '')) element.setAttribute('aria-current', 'page');
  const isControl = ['input', 'textarea', 'switch', 'picker'].includes(tag);
  if (isControl) {
    element.dataset.control = current().key + ':' + location;
    const field = owner.data.fields?.find(item => item.key === attrs['data-key']);
    element.setAttribute('aria-label', attrs['aria-label'] || field?.label || attrs.placeholder || (tag === 'switch' ? attrs['data-key'] || '仅看超时' : textContent(node) || '输入内容'));
    if (attrs.maxlength !== undefined) element.maxLength = Number(attrs.maxlength);
    if (attrs.placeholder) element.placeholder = attrs.placeholder;
    if (tag === 'switch') { element.type = 'checkbox'; element.checked = !!attrs.checked; }
    else if (tag === 'picker' && attrs.mode !== 'date') {
      (attrs.range || []).forEach((item, index) => { const option = document.createElement('option'); option.value = index; option.textContent = attrs['range-key'] ? item[attrs['range-key']] : String(item); element.append(option); });
      element.value = String(attrs.value || 0);
    } else {
      element.type = tag === 'picker' ? 'date' : attrs.type === 'digit' || attrs.type === 'number' ? 'text' : attrs.type || 'text';
      if (attrs.type === 'digit' || attrs.type === 'number') element.inputMode = attrs.type === 'digit' ? 'decimal' : 'numeric';
      element.value = attrs.value === undefined ? '' : attrs.value;
      if (tag === 'picker') element.classList.add('ap-date');
    }
    const handle = (name, value) => { const handler = attrs['bind' + name] || attrs['bind:' + name]; if (handler) invoke(owner, handler, element, { value }); };
    element.addEventListener('input', () => handle('input', element.value));
    element.addEventListener('change', () => handle('change', tag === 'switch' ? element.checked : element.value));
    element.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) handle('confirm', element.value); });
    element.addEventListener('compositionstart', () => { composing = true; });
    element.addEventListener('compositionend', () => { composing = false; scheduleRender(); });
  } else if (tag === 'image') {
    if (/^(?:data:image\/|https:\/\/(?:cdn.jsdelivr.net|cdnjs.cloudflare.com)\/)/.test(attrs.src || '')) element.src = attrs.src;
    element.alt = '示例凭证';
  } else {
    (node.children || []).forEach((child, index) => element.append(fromTree(child, owner, location + '-' + index)));
  }
  const icon = /(?:^|\s)icon-([\w-]+)/.exec(attrs.class || '');
  if (icon) { const placeholder = document.createElement('i'); placeholder.dataset.lucide = iconNames[icon[1]] || 'circle'; placeholder.setAttribute('aria-hidden', 'true'); element.classList.add('ap-icon'); element.append(placeholder); }
  return element;
}
async function invoke(page, handler, element, detail) {
  try { if (typeof page[handler] !== 'function') throw new Error('预览事件缺失：' + handler); await page[handler]({ currentTarget: { dataset: { ...element.dataset } }, detail }); }
  catch (error) { Ops.error(error); }
  scheduleRender();
}
function scheduleRender() {
  if (pendingRender || composing) return;
  pendingRender = true;
  queueMicrotask(() => { pendingRender = false; if (current()) render(); });
}
function render() {
  const entry = current(); if (!entry || composing) return;
  const active = document.activeElement;
  const focus = active && host.contains(active) && active.dataset.control ? { id: active.dataset.control, start: active.selectionStart, end: active.selectionEnd } : null;
  host.dataset.pageKey = entry.key;
  const tree = $gwx('.' + previewPages[entry.key].route + '.wxml')(entry.page.data, {}, {});
  host.replaceChildren(fromTree(tree, entry.page));
  titleNode.textContent = previewPages[entry.key].title;
  pageSelect.value = entry.key; backButton.disabled = stack.length < 2 && entry.key === 'home';
  if (focus) {
    const field = [...host.querySelectorAll('[data-control]')].find(element => element.dataset.control === focus.id);
    if (field && !field.disabled) { field.focus({ preventScroll: true }); if (focus.start !== null && field.setSelectionRange && field.type !== 'date') field.setSelectionRange(focus.start, focus.end); }
  }
  if (globalThis.lucide) lucide.createIcons({ attrs: { width: 18, height: 18 } });
}
pageSelect.addEventListener('change', () => navigate(pageSelect.value));
backButton.addEventListener('click', back);
navigate('home').then(() => {
  if (globalThis.Tweak) {
    const tweak = new Tweak({ container: root, onChange: () => { for (const entry of stack) Admin.isAdmin(entry.page); render(); } });
    tweak.addSelect(settings, 'role', { label: '管理员权限', options: [{ label: '超级管理员', value: 'super' }, { label: '普通管理员', value: 'admin' }] });
  }
});
