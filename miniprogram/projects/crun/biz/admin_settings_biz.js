const UI = require('./admin_console_biz.js');
const Ops = require('./operations_biz.js');
const KEYS = {
  service: ['enabled', 'enforceBusinessHours', 'openHour', 'closeHour'],
  pricing: ['smallPrice', 'mediumPrice', 'largePrice', 'maxPackages', 'offlineNotice'],
  rules: ['maxActiveOrders', 'maxOpenOrders', 'deliveryMinutes', 'urgentMinutes', 'urgentEnabled', 'registrationReview']
};
function dirty(page, value) {
  page.setData({ dirty: value });
  if (value && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '设置尚未保存，离开将丢失修改。' });
  if (!value && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
}
function apply(page, config) {
  page._saved = JSON.parse(JSON.stringify(config));
  page.setData({ config: JSON.parse(JSON.stringify(config)) });
  dirty(page, false);
}
function start(page) { if (UI.start(page)) return load(page); }
function show(page) {
  const reload = page._visible === false;
  page._visible = true;
  if (reload && !page.data.dirty) return load(page);
}
async function load(page) {
  if (!UI.authorize(page)) return;
  if (page.data.dirty || page.data.busy) { wx.showToast({ title: '请先保存或恢复修改', icon: 'none' }); return; }
  const seq = page._seq = (page._seq || 0) + 1;
  page.setData({ loading: true, error: '' });
  try {
    const config = await Ops.get('admin/operations_config');
    if (!config || !Array.isArray(config.campuses)) throw new Error('未读取到有效配置，请重试');
    if (page._visible && seq === page._seq) apply(page, config);
  } catch (error) { if (page._visible && seq === page._seq) page.setData({ error: UI.message(error) }); }
  finally { if (page._visible && seq === page._seq) page.setData({ loading: false }); }
}
function edit(page, event) {
  if (!page.data.isSuperAdmin || page.data.busy || !page.data.config) return;
  const key = event.currentTarget.dataset.key;
  if (!KEYS[page.data.section].includes(key)) return;
  page.setData({ ['config.' + key]: event.detail.value });
  dirty(page, true);
}
async function discard(page) {
  if (!page.data.dirty || page.data.busy || !page._saved) return;
  if (await UI.confirm('恢复已保存的设置', '当前未保存的修改将被放弃。')) apply(page, page._saved);
}
async function save(page) {
  if (!UI.authorize(page) || !page.data.isSuperAdmin || !page.data.config || page.data.busy || page.data.loading || page.data.error) return;
  const value = {};
  for (const key of KEYS[page.data.section]) value[key] = page.data.config[key];
  for (const field of page.data.fields) {
    const raw = String(value[field.key] === undefined ? '' : value[field.key]).trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < field.min || n > field.max || (field.type === 'number' && !Number.isInteger(n)) || (field.type === 'digit' && Math.abs(n * 100 - Math.round(n * 100)) > 1e-7)) {
      Ops.error(new Error(field.label + '须为 ' + field.min + ' 至 ' + field.max + (field.type === 'number' ? ' 的整数' : '，最多两位小数'))); return;
    }
    value[field.key] = n;
  }
  if (page.data.section === 'service') {
    if (value.openHour >= value.closeHour) { Ops.error(new Error('营业结束时间必须晚于开始时间')); return; }
  }
  if (page.data.section === 'rules' && value.urgentMinutes > value.deliveryMinutes) { Ops.error(new Error('加急时效不能长于普通单时效')); return; }
  page.setData({ busy: true });
  try {
    if (page.data.section === 'service' && !value.enabled && page._saved.enabled && !await UI.confirm('暂停接单服务', '暂停后，用户将无法发布或接取新订单，已有订单仍可继续履约。')) return;
    if (!page._visible) return;
    const config = await Ops.get('admin/operations_config_save', { section: page.data.section, value });
    if (!page._unloaded) { apply(page, config); if (page._visible) wx.showToast({ title: '设置已保存' }); }
  } catch (error) { if (page._visible) Ops.error(error); }
  finally { if (!page._unloaded) page.setData({ busy: false }); }
}
module.exports = { start, show, load, edit, discard, save };
