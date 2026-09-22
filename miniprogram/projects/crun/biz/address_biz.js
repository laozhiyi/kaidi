// Historical labels are recognized only when rendering saved addresses.
// Picker choices are always loaded from the selected campus configuration.
const LEGACY_PHASES = ['一期', '二期', '三期', '四期', '五期'];
const PHASES = [];
const clean = value => typeof value === 'string' ? value.trim() : '';
const PICKUP_STATIONS = [];
function configure(locations = {}) {
  PHASES.splice(0, PHASES.length, ...(locations.phases || []));
  PICKUP_STATIONS.splice(0, PICKUP_STATIONS.length, ...(locations.pickupStations || []).map(x=>({name:x.name,list:x.list.slice()})));
}
const knownPhases = () => [...new Set([...PHASES, ...LEGACY_PHASES])].sort((a,b)=>b.length-a.length);
const validLabel = value => knownPhases().includes(clean(value));

function phaseOf(address) {
  if (!address) return '';
  if (validLabel(address.label)) return clean(address.label);
  return knownPhases().find(phase => clean(address.detail).startsWith(phase)) || '';
}

function formatAddress(address) {
  if (!address) return '';
  const detail = clean(address.detail);
  const phase = validLabel(address.label) ? clean(address.label) : '';
  return phase && detail && !detail.startsWith(phase) ? phase + ' ' + detail : detail;
}

function formValue(mail, mark) {
  const forms = Array.isArray(mail.MAIL_FORMS) ? mail.MAIL_FORMS : [];
  const field = forms.find(item => item && item.mark === mark);
  return field && field.val;
}

function orderCampus(mail) {
  const value = clean(formValue(mail, 'campus')) || clean((mail.MAIL_OBJ || {}).campus);
  const match = value.match(/^(.+?校区)[\s·：:-]+.+$/);
  return match ? match[1] : value;
}

function orderAddress(mail) {
  const obj = mail.MAIL_OBJ || {};
  const campus = orderCampus(mail);
  const withoutCampus = value => {
    const address = clean(value);
    return campus && address.startsWith(campus) ? address.slice(campus.length).replace(/^[\s·：:-]+/, '') : address;
  };
  const rawCampus = clean(formValue(mail, 'campus')) || clean(obj.campus);
  const campusDetail = rawCampus.match(/^.+?校区[\s·：:-]+(.+)$/);
  const savedValue = withoutCampus(formValue(mail, 'address2'));
  const snapshot = withoutCampus(obj.address2);
  // The publisher's saved order form is the source; MAIL_OBJ is a derived snapshot.
  let saved = savedValue;
  let phase = [formValue(mail, 'addressPhase'), !saved || saved === snapshot ? obj.addressPhase : '']
    .map(clean).find(validLabel) || '';
  const trailingPhase = saved.match(/^(.+?)\s*[·•]\s*(一期|二期|三期|四期|五期)$/);
  if (trailingPhase) {
    saved = trailingPhase[1].trim();
    phase = phase || trailingPhase[2];
  }
  if (campusDetail && (!saved || knownPhases().includes(saved))) {
    phase = phase || (knownPhases().includes(saved) ? saved : '');
    saved = campusDetail[1].trim();
  }
  let address = saved || snapshot;
  if (address && !phaseOf({ detail: address })) {
    address = formatAddress({ label: phase, detail: address });
  }
  return address;
}

function formatOrderAddress(mail) {
  const address = orderAddress(mail);
  const campus = orderCampus(mail);
  return address && campus ? campus + ' · ' + address : address;
}

module.exports = { PHASES, PICKUP_STATIONS, configure, phaseOf, formatAddress, orderAddress, formatOrderAddress };
