const MINUTE = 60000;
const DAY = 86400000;
const STEP = 5 * MINUTE;
const ZONE = 8 * 60 * MINUTE;
const pad = value => String(value).padStart(2, '0');

function format(timestamp) {
  return new Date(timestamp + ZONE).toISOString().slice(0, 16).replace('T', ' ');
}

function parse(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value.replace(' ', 'T') + ':00+08:00');
  return Number.isFinite(timestamp) && format(timestamp) === value ? timestamp : NaN;
}

function valid(value, now = Date.now()) {
  const timestamp = parse(value);
  return timestamp > now && timestamp <= now + 7 * DAY;
}

function after(duration = 3 * DAY, now = Date.now()) {
  return format(Math.min(Math.ceil((now + duration) / STEP) * STEP, Math.floor((now + 7 * DAY) / STEP) * STEP));
}

function options(value, now = Date.now(), requestedDate, requestedHour) {
  const min = Math.ceil((now + 1) / STEP) * STEP;
  const max = now + 7 * DAY;
  const proposed = parse(value);
  const timestamp = Number.isFinite(proposed) && proposed > now && proposed <= max
    ? Math.min(Math.ceil(proposed / STEP) * STEP, Math.floor(max / STEP) * STEP) : min;
  const selected = format(timestamp);
  const today = format(now).slice(0, 10);
  const days = [];
  for (let offset = 0; offset <= 7; offset++) {
    const day = format(parse(today + ' 00:00') + offset * DAY).slice(0, 10);
    const start = parse(day + ' 00:00');
    if (start + DAY - STEP < min || start > max) continue;
    const weekday = new Date(start + ZONE).getUTCDay();
    days.push({ value: day, label: offset === 0 ? '今天' : offset === 1 ? '明天' : '周' + '日一二三四五六'[weekday], date: day.slice(5).replace('-', '月') + '日' });
  }
  const date = days.some(day => day.value === requestedDate) ? requestedDate : selected.slice(0, 10);
  const available = (hour, minute) => {
    const time = parse(date + ' ' + hour + ':' + minute);
    return time >= min && time <= max;
  };
  const minutes = Array.from({ length: 12 }, (_, index) => pad(index * 5));
  const hours = Array.from({ length: 24 }, (_, index) => {
    const hour = pad(index);
    return { value: hour, disabled: !minutes.some(minute => available(hour, minute)) };
  });
  const preferredHour = requestedHour || selected.slice(11, 13);
  const hour = hours.some(item => item.value === preferredHour && !item.disabled) ? preferredHour : hours.find(item => !item.disabled).value;
  const minuteOptions = minutes.map(minute => ({ value: minute, disabled: !available(hour, minute) }));
  const preferredMinute = selected.slice(14, 16);
  const minute = minuteOptions.some(item => item.value === preferredMinute && !item.disabled) ? preferredMinute : minuteOptions.find(item => !item.disabled).value;
  return { days, hours, minutes: minuteOptions, selectedDate: date, selectedHour: hour, selectedMinute: minute, draft: date + ' ' + hour + ':' + minute };
}

module.exports = { format, parse, valid, after, options };
