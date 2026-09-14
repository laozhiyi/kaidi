'use strict';

const PHASES = ['一期', '二期', '三期', '四期', '五期'];
const clean = value => typeof value === 'string' ? value.trim() : '';
function withoutCampus(value, campus) {
 const address = clean(value), prefix = clean(campus);
 return prefix && address.startsWith(prefix) ? address.slice(prefix.length).replace(/^[\s·：:-]+/, '') : address;
}
const phaseOf = (value, campus) => PHASES.find(phase => withoutCampus(value, campus).startsWith(phase)) || '';
function formValue(forms, mark) {
 const field = (Array.isArray(forms) ? forms : []).find(item => item && item.mark === mark);
 return field ? field.val : undefined;
}
function campusOf(mail) {
 const value = clean(formValue(mail.MAIL_FORMS, 'campus')) || clean((mail.MAIL_OBJ || {}).campus);
 const match = value.match(/^(.+?校区)[\s·：:-]+.+$/);
 return match ? match[1] : value;
}

function resolve(mail) {
 const obj = mail.MAIL_OBJ || {};
 const campus = campusOf(mail);
 const rawCampus = clean(formValue(mail.MAIL_FORMS, 'campus')) || clean(obj.campus);
 const campusDetail = rawCampus.match(/^.+?校区[\s·：:-]+(.+)$/);
 const saved = withoutCampus(formValue(mail.MAIL_FORMS, 'address2'), campus);
 const snapshot = withoutCampus(obj.address2, campus);
 let detail = saved || snapshot;
 let phase = [formValue(mail.MAIL_FORMS, 'addressPhase'), !saved || saved === snapshot ? obj.addressPhase : '']
  .map(clean).find(value => PHASES.includes(value)) || '';
 const trailingPhase = detail.match(/^(.+?)\s*[·•]\s*(一期|二期|三期|四期|五期)$/);
 if (trailingPhase) { detail = trailingPhase[1].trim(); phase = phase || trailingPhase[2]; }
 if (campusDetail && (!saved || PHASES.includes(saved))) {
  phase = phase || (PHASES.includes(saved) ? saved : '');
  detail = campusDetail[1].trim();
 }
 // Read this order's submitted address, including its phase, before the derived object.
 if (!detail || phaseOf(detail)) return detail;
 return phase ? phase + ' ' + detail : detail;
}

function complete(mail) {
 const address2 = resolve(mail), campus = campusOf(mail);
 const addressPhase = phaseOf(address2), obj = mail.MAIL_OBJ || {};
 if (!address2 || address2 === obj.address2 && campus === clean(obj.campus) && addressPhase === clean(obj.addressPhase)) return mail;
 const result = { ...obj, address2, ...(campus ? { campus } : {}) };
 if (addressPhase) result.addressPhase = addressPhase;
 else delete result.addressPhase;
 return { ...mail, MAIL_OBJ: result };
}

module.exports = { PHASES, phaseOf, resolve, complete };
