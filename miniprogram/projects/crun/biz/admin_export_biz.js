const UI = require('./admin_console_biz.js');
const Ops = require('./operations_biz.js');
const files = require('../../../helper/file_helper.js');
function route(page, action) { return 'admin/' + page.data.reportType + '_data_' + action; }
function start(page, options = {}) {
  if (!UI.start(page)) return;
  const today = UI.time(Date.now()).slice(0, 10), startDate = UI.time(Date.now() - 6 * 86400000).slice(0, 10);
  page.setData({ startDate, endDate: today, condition: options.condition || '' });
  return load(page);
}
async function load(page) {
  if (!UI.authorize(page) || page.data.busy) return;
  const seq = page._seq = (page._seq || 0) + 1;
  page.setData({ loading: true, error: '' });
  try {
    const report = await Ops.get(route(page, 'get'), { isDel: 0 });
    if (page._visible && seq === page._seq) page.setData({ reportUrl: report.url || '', generatedAt: report.time || '' });
  } catch (error) { if (page._visible && seq === page._seq) page.setData({ error: UI.message(error) }); }
  finally { if (page._visible && seq === page._seq) page.setData({ loading: false }); }
}
async function generate(page) {
  if (!UI.authorize(page) || page.data.busy || page.data.loading) return;
  const params = page.data.reportType === 'mail' ? { start: page.data.startDate, end: page.data.endDate, status: [999, 0, 1, 4, 2, 3, 9, 99][page.data.statusIndex] } : { condition: page.data.condition };
  if (page.data.reportType === 'mail' && (!params.start || !params.end || params.start > params.end)) { Ops.error(new Error('请选择正确的起止日期')); return; }
  page.setData({ busy: true });
  try {
    const report = await Ops.get(route(page, 'export'), params);
    if (!report || !report.url) throw new Error('报表生成失败，请重试');
    if (page._visible) { page.setData({ reportUrl: report.url, total: report.total, generatedAt: UI.time(Date.now()), error: '' }); wx.showToast({ title: '报表已生成' }); }
  } catch (error) { if (page._visible) Ops.error(error); }
  finally { if (!page._unloaded) page.setData({ busy: false }); }
}
async function remove(page) {
  if (!UI.authorize(page) || page.data.busy || !page.data.reportUrl) return;
  page.setData({ busy: true });
  try {
    if (!await UI.confirm('删除导出文件', '仅删除当前账号生成的报表，原始业务数据保留。')) return;
    if (!page._visible) return;
    await Ops.get(route(page, 'del'));
    if (page._visible) page.setData({ reportUrl: '', generatedAt: '', total: null });
  } catch (error) { if (page._visible) Ops.error(error); }
  finally { if (!page._unloaded) page.setData({ busy: false }); }
}
function copy(page) { if (page.data.reportUrl) wx.setClipboardData({ data: page.data.reportUrl }); }
function open(page) { if (page.data.reportUrl) return files.openDoc(page.data.reportType === 'mail' ? '订单报表' : '用户报表', page.data.reportUrl); }
module.exports = { start, load, generate, remove, copy, open };
