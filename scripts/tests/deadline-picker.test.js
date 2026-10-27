'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Deadline = require('../../miniprogram/projects/crun/biz/deadline_biz.js');

const MINUTE = 60000;
const point = timestamp => Deadline.endpoint(timestamp);

test('expectation ranges stay inside the server seven-day window and keep the delivery lead', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');
  const lead = 120 * MINUTE;
  const initial = Deadline.normalize('', now, lead);
  assert.equal(Deadline.validate(initial, now, lead), '');
  assert.ok(Deadline.at(initial.start) >= now + lead);
  assert.ok(Deadline.at(initial.end) <= now + Deadline.MAX_DAYS * Deadline.DAY);
  for (const minutes of [30, 60, 180]) {
    const preset = Deadline.preset(minutes, now, lead);
    assert.equal(Deadline.validate(preset, now, lead), '');
    assert.ok(Deadline.at(preset.start) >= now + lead);
    const text = Deadline.rangeText(preset);
    assert.deepEqual(Deadline.parseRange(text), preset);
  }
});

test('invalid, reversed and out-of-window ranges cannot be accepted; stale values recover to a future range', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');
  assert.match(Deadline.validate({ start: point(now - 3600000), end: point(now + 3600000) }, now), /晚于当前时间|配送时间/);
  assert.match(Deadline.validate({ start: point(now + 7200000), end: point(now + 7260000) }, now), /10 分钟/);
  assert.match(Deadline.validate({ start: point(now + 3600000), end: point(now + 8 * Deadline.DAY) }, now), /7 天/);
  for (const value of ['', '2026-02-30 12:00 ~ 2026-02-30 13:00', '2026-09-14 10:00', 'abc ~ def']) {
    const range = Deadline.normalize(value, now, 0);
    assert.equal(Deadline.validate(range, now, 0), '');
  }
  // 旧订单只存了一个时间点，也按「起止相同」的区间回填。
  assert.deepEqual(Deadline.parseRange('2026-10-30 13:00'), { start: { date: '2026-10-30', hour: '13', minute: '00' }, end: { date: '2026-10-30', hour: '13', minute: '00' } });
});

test('快捷按钮不再承诺做不到的时间：一律以最早可送达为基准', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');
  const lead = 120 * MINUTE;
  const quicks = Deadline.quickOptions(now, lead);
  assert.deepEqual(quicks.map(item => item.label), ['尽快送达', '1 小时后', '3 小时后']);
  // 「尽快送达」就是 earliest，且要严格大于服务端的 now + 配送时长。
  assert.ok(Deadline.at(Deadline.quickRange(0, now, lead).start) > now + lead);
  assert.equal(quicks[1].time - quicks[0].time, 60 * MINUTE);
  for (const item of quicks) assert.equal(Deadline.validate(Deadline.quickRange(item.minutes, now, lead), now, lead), '');
});

test('the picker edits one draft range with wheel, date and manual input, and only emits after confirmation', () => {
  let definition;
  const events = [];
  const value = Deadline.rangeText(Deadline.defaultRange());
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/cmpts/deadline_picker/deadline_picker.js'), 'utf8'), {
    Component: item => { definition = item; }, require: () => Deadline, wx: { hideKeyboard() {} }, Date
  });
  const picker = {
    ...definition.methods,
    data: { value, disabled: false, lead: 0, visible: false, display: '', active: 'start', days: [], hours: Deadline.HOURS, minutes: Deadline.MINUTES, start: null, end: null, wheel: [0, 0], manual: '', draft: '', summary: '', error: '' },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  picker._syncDisplay();
  assert.equal(picker.data.display, Deadline.rangeLabel(Deadline.parseRange(value)));

  picker.open();
  assert.equal(picker.data.visible, true);
  assert.equal(events.length, 0);
  picker.selectQuick({ currentTarget: { dataset: { minutes: 180 } } });
  const preset = picker.data.draft;
  picker.confirm();
  assert.deepEqual(events, [{ name: 'select', detail: preset }]);
  assert.equal(picker.data.visible, false);

  // 滚轮、日期与手动输入都作用在当前选中端（最早 / 最晚）。
  picker.open();
  picker.selectEndpoint({ currentTarget: { dataset: { field: 'end' } } });
  assert.equal(picker.data.active, 'end');
  picker.wheelChange({ detail: { value: [9, 5] } });
  assert.equal(picker.data.end.hour, '09');
  assert.equal(picker.data.end.minute, '05');
  const day = picker.data.days[picker.data.days.length - 1].value;
  picker.selectDate({ currentTarget: { dataset: { value: day } } });
  assert.equal(picker.data.end.date, day);
  picker.manualInput({ detail: { value: day + ' 08:07' } });
  assert.equal(picker.data.end.hour, '08');
  assert.equal(picker.data.end.minute, '07');
  assert.equal(picker.data.manual, day + ' 08:07');

  // 已失效的区间不允许确认，面板保持打开并给出提示。
  picker._apply({ start: point(Date.now() - 86400000), end: point(Date.now() + 3600000) });
  picker.confirm();
  assert.equal(events.length, 1);
  assert.equal(picker.data.visible, true);
  assert.ok(picker.data.error);
});
