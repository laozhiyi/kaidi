// 「期待送达时间」是一个时间段：最早 ~ 最晚，精确到分钟。
// 只要骑手在区间内送达就不算超时，服务端以区间最晚时间作为超时判定。
const MINUTE = 60000;
const DAY = 86400000;
const ZONE = 8 * 60 * MINUTE;
const MAX_DAYS = 7;
// 区间至少留出的宽度，避免用户选出「同时刻」的无效区间。
const MIN_SPAN = 10 * MINUTE;
const SEP = ' ~ ';
const pad = value => String(value).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, index) => pad(index));
const MINUTES = Array.from({ length: 60 }, (_, index) => pad(index));

function format(timestamp) {
  return new Date(timestamp + ZONE).toISOString().slice(0, 16).replace('T', ' ');
}

function parse(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value.replace(' ', 'T') + ':00+08:00');
  return Number.isFinite(timestamp) && format(timestamp) === value ? timestamp : NaN;
}

function endpoint(timestamp) {
  const value = format(timestamp);
  return { date: value.slice(0, 10), hour: value.slice(11, 13), minute: value.slice(14, 16) };
}

function text(point) {
  return point.date + ' ' + point.hour + ':' + point.minute;
}

function at(point) {
  return parse(text(point));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// 最早可送达时间：多留 1 分钟余量，服务端是严格大于（startAt > now + 配送时长）。
const earliest = (now, lead) => now + Math.max(5 * MINUTE, (Number(lead) || 0) + MINUTE);

// 未来的可选日期：今天起 7 天内。
function days(now = Date.now(), lead = 0) {
  const from = now + Math.max(0, Number(lead) || 0);
  const today = format(now).slice(0, 10);
  const list = [];
  for (let offset = 0; offset <= MAX_DAYS; offset++) {
    const day = format(parse(today + ' 00:00') + offset * DAY).slice(0, 10);
    const start = parse(day + ' 00:00');
    if (start + DAY < from || start > now + MAX_DAYS * DAY) continue;
    const weekday = new Date(start + ZONE).getUTCDay();
    list.push({ value: day, label: offset === 0 ? '今天' : offset === 1 ? '明天' : '周' + '日一二三四五六'[weekday], date: day.slice(5).replace('-', '月') + '日' });
  }
  return list;
}

// 单个端点归一到合法范围：不早于 now+lead，不晚于 7 天。
function normalizePoint(point, now, lead, isEnd = false) {
  const min = earliest(now, lead), max = now + MAX_DAYS * DAY;
  const value = at(point);
  if (!Number.isFinite(value)) return endpoint(isEnd ? Math.min(now + 3 * 3600000 + 30 * MINUTE, max) : Math.min(now + 3 * 3600000, max));
  return endpoint(clamp(value, min, max));
}

function defaultRange(now = Date.now(), lead = 0) {
  const min = earliest(now, lead);
  const start = Math.ceil(min / MINUTE) * MINUTE + 3 * 3600000;
  return { start: endpoint(start), end: endpoint(start + 30 * MINUTE) };
}

// 以某个时间点为起点生成区间：起点不早于 now+lead，宽度固定 30 分钟。
function presetAt(timestamp, now = Date.now(), lead = 0) {
  const min = earliest(now, lead);
  const start = Math.max(Math.ceil(min / MINUTE) * MINUTE, Math.ceil((Number(timestamp) || 0) / MINUTE) * MINUTE);
  return { start: endpoint(start), end: endpoint(Math.min(start + 30 * MINUTE, now + MAX_DAYS * DAY)) };
}

function preset(minutes = 180, now = Date.now(), lead = 0) {
  return presetAt(now + Number(minutes) * MINUTE, now, lead);
}

// 快捷按钮不给「30 分钟后」这种会被配送时长推翻的承诺：
// 一律以「最早可送达」为基准，标签就是点击后真正生效的时间。
function quickRange(minutes = 0, now = Date.now(), lead = 0) {
  return presetAt(earliest(now, lead) + Number(minutes) * MINUTE, now, lead);
}

function quickOptions(now = Date.now(), lead = 0) {
  return [{ minutes: 0, label: '尽快送达' }, { minutes: 60, label: '1 小时后' }, { minutes: 180, label: '3 小时后' }]
    .map(item => ({ minutes: item.minutes, label: item.label, time: at(quickRange(item.minutes, now, lead).start) }));
}

// 兼容旧值：单个时间点会被当作起止相同的区间。
function parseRange(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const [from, to] = value.split(/\s*~\s*/);
  const startAt = parse(from);
  const endAt = to === undefined ? startAt : parse(to);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  return { start: endpoint(startAt), end: endpoint(endAt) };
}

function rangeText(range) {
  return text(range.start) + SEP + text(range.end);
}

function normalize(value, now = Date.now(), lead = 0) {
  const parsed = parseRange(value);
  if (!parsed) return defaultRange(now, lead);
  const range = { start: normalizePoint(parsed.start, now, lead), end: normalizePoint(parsed.end, now, lead, true) };
  // 旧值可能只是一个时间点：补足最小宽度，避免回填出无效区间。
  const max = now + MAX_DAYS * DAY;
  let start = at(range.start), end = at(range.end);
  if (end - start < MIN_SPAN) {
    end = Math.min(start + 30 * MINUTE, max);
    if (end - start < MIN_SPAN) start = end - 30 * MINUTE;
    range.start = endpoint(start);
    range.end = endpoint(end);
  }
  return range;
}

// 返回空串表示合法，否则返回提示文案。
function validate(range, now = Date.now(), lead = 0) {
  const start = at(range.start), end = at(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '请选择完整的送达时间段';
  const min = earliest(now, lead);
  if (start < min) return (lead > 0 ? '最早送达至少要留出 ' + Math.max(1, Math.round(lead / MINUTE)) + ' 分钟的配送时间' : '最早送达时间需晚于当前时间');
  if (end > now + MAX_DAYS * DAY) return '只能在未来 7 天内选择送达时间';
  if (end - start < MIN_SPAN) return '最晚送达时间需比最早晚 10 分钟以上';
  return '';
}

// 同一天合并成一段，跨天保留完整日期。
function label(point) {
  if (!point) return '';
  const value = typeof point === 'number' ? point : at(point);
  if (!Number.isFinite(value) || value <= 0) return '';
  const d = new Date(value + ZONE);
  const time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  const dayKey = ts => Math.floor((ts + ZONE) / DAY);
  const diff = dayKey(value) - dayKey(Date.now());
  if (diff === 0) return '今天 ' + time;
  if (diff === 1) return '明天 ' + time;
  if (diff === 2) return '后天 ' + time;
  return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + time;
}

function rangeLabel(range) {
  if (!range) return '';
  const from = label(range.start), to = label(range.end);
  if (!from) return to;
  if (!to) return from;
  const cut = value => { const at = value.indexOf(' '); return at < 0 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]; };
  const [dayFrom, timeFrom] = cut(from), [dayTo, timeTo] = cut(to);
  return dayFrom === dayTo && dayTo ? dayFrom + ' ' + timeFrom + ' ~ ' + timeTo : from + ' ~ ' + to;
}

module.exports = { MINUTE, DAY, MAX_DAYS, MIN_SPAN, SEP, HOURS, MINUTES, format, parse, text, at, endpoint, days, preset, presetAt, quickRange, quickOptions, defaultRange, parseRange, rangeText, normalize, validate, label, rangeLabel };
