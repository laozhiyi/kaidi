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
  return '';
}
function isComplete(user) {
  return !!user && user.USER_PROFILE_COMPLETE !== false && !validationError({ name: user.USER_NAME,
    mobile: user.USER_MOBILE, pic: user.USER_PIC, forms: user.USER_FORMS });
}
function allowsManualRegistration() { return config.ALLOW_MANUAL_REGISTRATION === true; }
function isReady(user) { return !!user && (user.USER_MOBILE_VERIFIED === true || allowsManualRegistration()) && isComplete(user); }
module.exports = { formValue, validationError, isComplete, isReady, allowsManualRegistration };
