'use strict';

// 默认地点表与校区种子数据同源；运行时应以 tenant 配置里的 locations.phases 为准。
const { YANSHAN_PHASES: PHASES } = require('./tenant_defaults.js');
// 早期安装只有「一期~五期」这套标记，雁山校区已按地图改为具体地点名。
// 存量用户地址和存订单里仍是旧标记，解析和校验都要继续认。
const LEGACY_PHASES = ['一期', '二期', '三期', '四期', '五期'];
const clean = value => typeof value === 'string' ? value.trim() : '';
function withoutCampus(value, campus) {
 const address = clean(value), prefix = clean(campus);
 return prefix && address.startsWith(prefix) ? address.slice(prefix.length).replace(/^[\s·：:-]+/, '') : address;
}
// 长名优先，避免「体育场」抢在「标准体育场」前面匹配。
const allPhases = phases => [...new Set([...(phases || PHASES), ...LEGACY_PHASES])].sort((a,b)=>b.length-a.length);
const phaseOf = (value, campus, phases) => allPhases(phases).find(phase => withoutCampus(value, campus).startsWith(phase)) || '';
function formValue(forms, mark) {
 const field = (Array.isArray(forms) ? forms : []).find(item => item && item.mark === mark);
 return field ? field.val : undefined;
}

// 可选择、可提交的地点：配置未更新时回落到默认表，并始终保留旧标记以兼容存量数据。
function phasesOf(locations) {
 const list = locations && Array.isArray(locations.phases)
  ? locations.phases.map(item => clean(item)).filter(Boolean) : [];
 const picked = !list.length || list.every(item => LEGACY_PHASES.includes(item)) ? PHASES.slice() : list;
 return [...new Set([...picked, ...LEGACY_PHASES])];
}
function campusOf(mail) {
 const value = clean(formValue(mail.MAIL_FORMS, 'campus')) || clean((mail.MAIL_OBJ || {}).campus);
 const match = value.match(/^(.+?校区)[\s·：:-]+.+$/);
 return match ? match[1] : value;
}

function resolve(mail, phases = PHASES) {
 const obj = mail.MAIL_OBJ || {};
 const campus = campusOf(mail);
 const rawCampus = clean(formValue(mail.MAIL_FORMS, 'campus')) || clean(obj.campus);
 const campusDetail = rawCampus.match(/^.+?校区[\s·：:-]+(.+)$/);
 const saved = withoutCampus(formValue(mail.MAIL_FORMS, 'address2'), campus);
 const snapshot = withoutCampus(obj.address2, campus);
 let detail = saved || snapshot;
 let phase = [formValue(mail.MAIL_FORMS, 'addressPhase'), !saved || saved === snapshot ? obj.addressPhase : '']
  .map(clean).find(value => value && value.length <= 30) || '';
 const trailingPhase = detail.match(/^(.+?)\s*[·•]\s*(一期|二期|三期|四期|五期)$/);
 if (trailingPhase) { detail = trailingPhase[1].trim(); phase = phase || trailingPhase[2]; }
 if (campusDetail && (!saved || allPhases(phases).includes(saved))) {
  phase = phase || (allPhases(phases).includes(saved) ? saved : '');
  detail = campusDetail[1].trim();
 }
 // Read this order's submitted address, including its phase, before the derived object.
 if (!detail || phaseOf(detail, '', phases) || phase && detail.startsWith(phase)) return detail;
 return phase ? phase + ' ' + detail : detail;
}

function complete(mail) {
 const address2 = resolve(mail), campus = campusOf(mail);
 const obj = mail.MAIL_OBJ || {}, addressPhase = clean(formValue(mail.MAIL_FORMS, 'addressPhase')) || clean(obj.addressPhase) || phaseOf(address2);
 if (!address2 || address2 === obj.address2 && campus === clean(obj.campus) && addressPhase === clean(obj.addressPhase)) return mail;
 const result = { ...obj, address2, ...(campus ? { campus } : {}) };
 if (addressPhase) result.addressPhase = addressPhase;
 else delete result.addressPhase;
 return { ...mail, MAIL_OBJ: result };
}

module.exports = { PHASES, LEGACY_PHASES, phasesOf, phaseOf, resolve, complete };
