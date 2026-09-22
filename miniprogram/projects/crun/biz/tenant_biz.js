const STORAGE = 'crun-campus-context';
const listeners = new Set();
let catalog = null, pending = null, busy = 0, generation = 0;
const valid = value => value && /^[a-z][a-z0-9_-]{1,47}$/.test(value.schoolId || '') && /^[a-z][a-z0-9_-]{1,47}$/.test(value.campusId || '');
function snapshot() { const saved = wx.getStorageSync(STORAGE); return valid(saved) ? { ...saved } : null; }
function key(value = snapshot()) { return value ? value.schoolId + '/' + value.campusId : ''; }
async function directory(loader, force = false) {
  if (catalog && !force) return catalog;
  if (pending) return pending;
  pending = Promise.resolve().then(loader).then(result => {
    if (!result || !Array.isArray(result.schools) || !Array.isArray(result.campuses) || result.schools.some(row => !row || !/^[a-z][a-z0-9_-]{1,47}$/.test(row.schoolId || '') || typeof row.name !== 'string') || result.campuses.some(row => !valid(row) || !result.schools.some(school => school.schoolId === row.schoolId))) throw new Error('学校目录暂不可用，请重试');
    catalog = result; return result;
  }).finally(() => { pending = null; });
  return pending;
}
function select(value, { reload = true, allowDisabled = false } = {}) {
  if (!valid(value)) throw new Error('请选择有效的学校和校区');
  const previous = snapshot();
  if (busy && previous && key(previous) !== key(value)) throw new Error('操作仍在处理中，请完成后再切换校区');
  const school = catalog && catalog.schools.find(row => row.schoolId === value.schoolId);
  const campus = catalog && catalog.campuses.find(row => row.schoolId === value.schoolId && row.campusId === value.campusId);
  if (!school || !campus) throw new Error('请选择有效的学校和校区');
  if (!allowDisabled && (school.enabled === false || campus.enabled === false)) throw new Error('学校或校区已停用，请重新选择');
  const next = { schoolId: school.schoolId, campusId: campus.campusId, schoolName: school.name, campusName: campus.name };
  wx.setStorageSync(STORAGE, next);
  if (key(previous) !== key(next)) {
    generation++;
    // Login profiles belong to a school; commands/recovery identifiers are kept.
    if (!previous || previous.schoolId !== next.schoolId) {
      for (const name of ['CACHE_TOKEN', 'CACHE_TOKEN_deadtime']) wx.removeStorageSync(name);
    }
    if (typeof wx.getStorageInfoSync === 'function') for (const name of wx.getStorageInfoSync().keys || []) {
      if (/_LIST(?:_deadtime)?$/.test(name)) wx.removeStorageSync(name);
    }
    for (const listener of listeners) { try { listener(next, previous); } catch (_) {} }
    if (reload && typeof wx.reLaunch === 'function') {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const admin = pages.length && /\/admin\//.test(pages[pages.length - 1].route || '');
      wx.reLaunch({ url: admin ? '/projects/crun/pages/admin/settings/index/admin_settings' : '/projects/crun/pages/default/index/default_index' });
    }
  }
  return next;
}
async function ensure(loader, { allowDisabled = false } = {}) {
  const saved = snapshot();
  if (saved) return saved;
  const rows = await directory(loader);
  const first = rows.campuses.find(campus => allowDisabled || campus.enabled !== false && rows.schools.some(school => school.schoolId === campus.schoolId && school.enabled !== false));
  if (!first) throw new Error('暂无开放的学校和校区，请稍后重试');
  return select(first, { reload: false, allowDisabled });
}
function lock() { busy++; let released = false; return () => { if (!released) { released = true; busy--; } }; }
module.exports = { snapshot, key, directory, ensure, select, lock, generation: () => generation,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
