function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : null; } catch (_) { return null; }
}
function formValue(forms, mark) {
  const item = (Array.isArray(forms) ? forms : []).find(x => x && x.mark === mark);
  return item && item.val != null ? item.val : '';
}
function hasMark(forms, mark) { return (Array.isArray(forms) ? forms : []).some(x => x && x.mark === mark); }
function normalizeContacts(list) {
  const out = (Array.isArray(list) ? list : []).map(x => ({ name: String(x && x.name || '').trim(), phone: String(x && x.phone || '').trim(), isDefault: !!(x && x.isDefault) })).filter(x => x.name || x.phone);
  return setDefault(out);
}
function normalizeAddresses(list) {
  const out = (Array.isArray(list) ? list : []).map(x => ({ label: String(x && x.label || '常用地址').trim() || '常用地址', detail: String(x && x.detail || '').trim(), isDefault: !!(x && x.isDefault) })).filter(x => x.detail);
  return setDefault(out);
}
function setDefault(list) {
  let found = false;
  return list.map(x => { const yes = !found && x.isDefault; if (yes) found = true; return Object.assign({}, x, { isDefault: yes }); }).map((x, i) => Object.assign({}, x, { isDefault: found ? x.isDefault : i === 0 }));
}
function getDefaultItem(list) { return (Array.isArray(list) ? list : []).find(x => x && x.isDefault) || (Array.isArray(list) && list[0]) || null; }
function readProfile(user) {
  const forms = user && user.USER_FORMS || [];
  let contacts = parseList(formValue(forms, 'contacts'));
  let addresses = parseList(formValue(forms, 'addresses'));
  if (contacts === null && !hasMark(forms, 'contacts')) { const n = formValue(forms, 'commonContact'), p = formValue(forms, 'commonContactMobile'); contacts = n || p ? [{ name: n, phone: p }] : []; }
  if (addresses === null && !hasMark(forms, 'addresses')) { const d = formValue(forms, 'address'); addresses = d ? [{ label: '常用地址', detail: d }] : []; }
  const c = getDefaultItem(normalizeContacts(contacts || [])); const a = getDefaultItem(normalizeAddresses(addresses || []));
  return { contacts: normalizeContacts(contacts || []), addresses: normalizeAddresses(addresses || []), campus: String(formValue(forms, 'campus') || '').trim(), address2: String(formValue(forms, 'address2') || formValue(forms, 'address') || (a && a.detail) || '').trim(), poster: String(formValue(forms, 'poster') || formValue(forms, 'commonContact') || (c && c.name) || user.USER_NAME || '').trim(), tel: String(formValue(forms, 'tel') || formValue(forms, 'commonContactMobile') || (c && c.phone) || user.USER_MOBILE || '').trim(), tel2: String(formValue(forms, 'tel2') || '').trim() };
}
module.exports = { formValue, normalizeContacts, normalizeAddresses, getDefaultItem, readProfile };
