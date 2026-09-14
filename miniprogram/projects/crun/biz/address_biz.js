const PHASES = ['一期', '二期', '三期', '四期', '五期'];
const PICKUP_STATIONS = [
  { name: '二期', list: ['中通', '圆通', '申通', '韵达', '顺丰'] },
  { name: '五期', list: ['邮政', '极兔'] },
  { name: '奥林苑', list: ['京东'] }
];

function phaseOf(address) {
  if (!address) return '';
  if (PHASES.includes(address.label)) return address.label;
  return PHASES.find(phase => String(address.detail || '').trim().startsWith(phase)) || '';
}

function formatAddress(address) {
  if (!address) return '';
  const detail = String(address.detail || '').trim();
  const phase = PHASES.includes(address.label) ? address.label : '';
  return phase && detail && !detail.startsWith(phase) ? phase + ' ' + detail : detail;
}

module.exports = { PHASES, PICKUP_STATIONS, phaseOf, formatAddress };
