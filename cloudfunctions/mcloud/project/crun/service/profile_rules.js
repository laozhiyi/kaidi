'use strict';
const config = require('../../../config/config.js');
const nonempty = (value, max) => typeof value === 'string' && !!value.trim() && value.trim().length <= max;
function formValue(forms, mark) {
  const item = Array.isArray(forms) && forms.find(value => value && value.mark === mark);
  return item ? item.val : '';
}
function validationError({ name, mobile, pic, forms }) {
  if (!nonempty(name, 30)) return '请填写昵称（最多30字）';
  if (typeof mobile !== 'string' || !/^1[3-9][0-9]{9}$/.test(mobile)) return '手机号格式无效';
  if (!nonempty(pic, 500)) return '请选择头像';
  if (!Array.isArray(forms) || forms.length > 20 || JSON.stringify(forms).length > 10000
    || forms.some(item => !item || typeof item !== 'object' || !nonempty(item.mark, 80))
    || new Set(forms.map(item => item.mark)).size !== forms.length) return '个人资料格式无效';
  if (!['男', '女'].includes(formValue(forms, 'sex'))) return '请选择性别';
  if (!nonempty(formValue(forms, 'college'), 80)) return '请填写所在学院（最多80字）';
  if (!nonempty(formValue(forms, 'sub'), 80)) return '请填写所学专业（最多80字）';
  if (!nonempty(formValue(forms, 'campus'), 80)) return '请选择所在校区';
  // Student ID / card / disclaimer: format is checked whenever present. They are
  // only *required* at first registration (see requiredForRegistration) so that
  // existing accounts are never locked out.
  const studentId = formValue(forms, 'studentId');
  if (studentId !== '' && studentId !== undefined && !STUDENT_ID_RE.test(String(studentId).trim())) return '学号为6-20位字母或数字';
  const card = formValue(forms, 'studentCard');
  if (card !== '' && card !== undefined) {
    if (!Array.isArray(card) || card.length > 1 || card.some(value => !nonempty(value, 500))) return '学生证图片格式无效';
  }
  const disclaimer = formValue(forms, 'disclaimer');
  if (disclaimer !== '' && disclaimer !== undefined && typeof disclaimer !== 'boolean') return '免责声明状态无效';
  return '';
}
const STUDENT_ID_RE = /^[A-Za-z0-9]{6,20}$/;
const hasImage = value => {
  const list = Array.isArray(value) ? value : [value];
  return list.length > 0 && list.every(item => typeof item === 'string' && /^(?:cloud:\/\/|https?:\/\/)/.test(item));
};
/** Extra checks applied only when a profile is completed for the first time. */
function requiredForRegistration(forms) {
  if (!STUDENT_ID_RE.test(String(formValue(forms, 'studentId') || '').trim())) return '请填写学号（6-20位字母或数字）';
  if (!hasImage(formValue(forms, 'studentCard'))) return '请上传学生证照片';
  if (formValue(forms, 'disclaimer') !== true) return '请阅读并同意免责声明';
  return '';
}

function textForAudit({ name, forms }) {
  const fields = { 昵称: name };
  const add = (label, value) => {
    let key = label, suffix = 2;
    while (Object.prototype.hasOwnProperty.call(fields, key)) key = label + '（' + suffix++ + '）';
    fields[key] = value;
  };
  const labels = { __proto__: null, sex: '性别', college: '学院', sub: '专业', campus: '所在校区', payPic: '支付凭证',
    contacts: '常用联系人', addresses: '常用地址', address: '常用地址', commonContact: '常用联系人',
    commonContactMobile: '联系人手机', poster: '联系人', tel: '联系电话', tel2: '备用电话', address2: '送达地址',
    studentId: '学号', studentCard: '学生证', disclaimer: '免责声明' };
  const phone = value => typeof value === 'string' && /^\+?[\d\s-]{6,20}$/.test(value);
  for (const [index, item] of (forms || []).entries()) {
    const label = labels[item.mark] || '补充资料（第' + (index + 1) + '项）';
    // Normal form titles are schema metadata. A changed/custom title is text,
    // and client-supplied types must never hide known text fields from review.
    if (item.title && item.title !== labels[item.mark]) add(label + '标题', item.title);
    if (item.mark === 'sex' || item.mark === 'campus') continue;
    if (['commonContactMobile', 'tel', 'tel2'].includes(item.mark) && phone(item.val)) continue;
    if (item.mark === 'disclaimer' && typeof item.val === 'boolean') continue;
    if (item.mark === 'studentId' && STUDENT_ID_RE.test(String(item.val || '').trim())) continue;
    if (item.mark === 'payPic' || item.mark === 'studentCard') {
      const images = Array.isArray(item.val) ? item.val : [item.val];
      if (images.every(value => typeof value === 'string' && /^(?:cloud:\/\/|https?:\/\/)/.test(value))) continue;
    }
    if (item.mark === 'contacts' || item.mark === 'addresses') {
      let rows = item.val;
      if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch (_) { /* Audit legacy plain text below. */ } }
      if (Array.isArray(rows)) {
        rows.forEach((row, i) => {
          const prefix = label + '（第' + (i + 1) + '项）';
          if (!row || typeof row !== 'object') { add(prefix, row); return; }
          for (const [fieldIndex, [key, value]] of Object.entries(row).entries()) {
            if (key === 'phone' && phone(value)) continue;
            const suffix = { __proto__: null, name: '姓名', label: '名称', detail: '地址', phone: '电话' }[key]
              || '补充信息（第' + (fieldIndex + 1) + '项）';
            add(prefix + suffix, value);
          }
        });
        continue;
      }
    }
    add(label, item.val);
  }
  return fields;
}
function isComplete(user) {
  return !!user && user.USER_PROFILE_COMPLETE !== false && !validationError({ name: user.USER_NAME,
    mobile: user.USER_MOBILE, pic: user.USER_PIC, forms: user.USER_FORMS });
}
function isPhoneLoginEnabled() { return config.WECHAT_PHONE_LOGIN_ENABLED === true; }
function allowsManualRegistration() { return !isPhoneLoginEnabled() || config.ALLOW_MANUAL_REGISTRATION === true; }
function isReady(user) { return !!user && (user.USER_MOBILE_VERIFIED === true || allowsManualRegistration()) && isComplete(user); }
module.exports = { formValue, validationError, requiredForRegistration, textForAudit, isComplete, isReady, allowsManualRegistration, isPhoneLoginEnabled };
