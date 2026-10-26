// Historical labels are recognized only when rendering saved addresses.
// Picker choices are always loaded from the selected campus configuration.
//
// 雁山校区地点表取自《广西师范大学雁山校区地图》（2022 年 8 月制），顺序与图例编号一致。
// 云函数同名副本见 cloudfunctions/mcloud/project/crun/service/tenant_defaults.js，
// 两处必须同步；这里只在后端配置仍是旧的「一期~五期」时兜底。
const DEFAULT_PHASES = [
  '东大门', '校训石', '图书馆', '纯道楼', '静园', '诚园', '群园', '雅园', '北门', '怡园',
  '荟文楼', '独秀书房', '孔子广场', '明志楼', '桃园餐厅', '起文楼', '公共体育馆', '田径游泳馆',
  '体育馆', '室外训练场', '标准体育场', '西门', '综合体育馆', '训练馆', '音乐楼', '大学生创新创业中心',
  '环资学院实验中心', '伯康楼', '物理实验楼', '计算机实验楼', '数学实验楼', '电子工程实验楼',
  '校医院', '容园', '荷园餐厅', '创新创业学院', '恬园', '知园', '德园', '厚藩楼', '体育场', '校友林', '奥林苑'
];
const LEGACY_PHASES = ['一期', '二期', '三期', '四期', '五期'];
// 可选地点分两组：宿舍按一期~五期选（与宿舍区名一一对应，最常见），
// 其余是地图上的具体地点，排在面板下半部分，需要时往下滑。
const DORM_PHASES = [
  { label: '一期', name: '怡园' },
  { label: '二期', name: '雅园' },
  { label: '三期', name: '容园' },
  { label: '四期', name: '恬园' },
  { label: '五期', name: '知园' }
];
const DORM_LABELS = DORM_PHASES.map(item => item.label);
const DORM_NAMES = DORM_PHASES.reduce((map, item) => { map[item.name] = item.label; return map; }, {});
// 与默认地点表配套的取件点；配置还停留在旧期数时用它，避免地点与取件点对不上。
const DEFAULT_STATIONS = [
  { name: '雅园', list: ['中通', '圆通', '申通', '韵达', '顺丰'] },
  { name: '知园', list: ['邮政', '极兔'] },
  { name: '奥林苑', list: ['京东'] }
];
// 初始即为默认地点表，配置尚未到达时也能正常展示选项。
const PHASES = DEFAULT_PHASES.slice();
const clean = value => typeof value === 'string' ? value.trim() : '';
const PICKUP_STATIONS = DEFAULT_STATIONS.map(x => ({ name: x.name, list: x.list.slice() }));
const isLegacyOnly = list => !list.length || list.every(item => LEGACY_PHASES.includes(item));
function configure(locations = {}) {
  const phases = (locations.phases || []).map(clean).filter(Boolean);
  const legacy = isLegacyOnly(phases);
  PHASES.splice(0, PHASES.length, ...(legacy ? DEFAULT_PHASES : phases));
  const stations = legacy ? DEFAULT_STATIONS : (locations.pickupStations || []);
  PICKUP_STATIONS.splice(0, PICKUP_STATIONS.length, ...stations.map(x => ({ name: x.name, list: x.list.slice() })));
}
const knownPhases = () => [...new Set([...PHASES, ...LEGACY_PHASES])].sort((a,b)=>b.length-a.length);
const validLabel = value => knownPhases().includes(clean(value));

function phaseOf(address) {
  if (!address) return '';
  if (validLabel(address.label)) return clean(address.label);
  return knownPhases().find(phase => clean(address.detail).startsWith(phase)) || '';
}

// 把任意存量地址折算成面板里的一项：旧宿舍区名归到对应期数，其他地点名原样保留。
function initialPlace(address) {
  if (!address) return '';
  const label = clean(address.label), detail = clean(address.detail);
  if (DORM_NAMES[label]) return DORM_NAMES[label];
  if (validPlace(label)) return label;
  const place = knownPhases().find(phase => detail.startsWith(phase)) || '';
  return DORM_NAMES[place] || (validPlace(place) ? place : '');
}

// 宿舍区之外的地点沿用地点表顺序；宿舍区已由期数承载，不重复出现。
const otherPlaces = () => PHASES.filter(place => !DORM_NAMES[place]);
const validPlace = value => DORM_LABELS.includes(clean(value)) || otherPlaces().includes(clean(value));
const placeGroups = () => [
  { key: 'dorm', title: '宿舍区', hint: '按所属期数选', items: DORM_PHASES.map(item => ({ label: item.label, name: item.name })) },
  { key: 'campus', title: '校内地点', hint: '按地图图例顺序排列', items: otherPlaces().map(label => ({ label, name: '' })) }
];

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

module.exports = { PHASES, PICKUP_STATIONS, DORM_PHASES, DORM_LABELS, configure, phaseOf, initialPlace, validPlace, otherPlaces, placeGroups, formatAddress, orderAddress, formatOrderAddress };
