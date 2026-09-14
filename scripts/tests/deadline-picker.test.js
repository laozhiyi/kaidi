'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Deadline = require('../../miniprogram/projects/crun/biz/deadline_biz.js');

test('deadline choices stay within the server seven-day window across Shanghai midnight and month boundaries', () => {
  for (const now of ['2026-09-14T15:58:30Z', '2026-12-31T15:59:59Z', '2028-02-29T15:59:59Z'].map(Date.parse)) {
    const initial = Deadline.options('', now);
    assert.equal(Deadline.valid(initial.draft, now), true);
    for (const day of initial.days) {
      const dated = Deadline.options(initial.draft, now, day.value);
      for (const hour of dated.hours.filter(item => !item.disabled)) {
        const hourly = Deadline.options(dated.draft, now, day.value, hour.value);
        assert.equal(Deadline.valid(hourly.draft, now), true);
        for (const minute of hourly.minutes.filter(item => !item.disabled)) {
          assert.equal(Deadline.valid(day.value + ' ' + hour.value + ':' + minute.value, now), true);
        }
      }
    }
    assert.equal(Deadline.valid(Deadline.after(undefined, now), now), true);
  }
});

test('invalid, past and out-of-range deadlines cannot be accepted and stale dates recover to a future choice', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');
  for (const value of ['', '2026-02-30 12:00', '2026-09-14 10:00', '2026-09-21 10:05', '2026-09-14 24:00']) {
    assert.equal(Deadline.valid(value, now), false);
    assert.equal(Deadline.valid(Deadline.options(value, now).draft, now), true);
  }
  assert.equal(Deadline.valid('2026-09-21 10:00', now), true);
  assert.equal(Deadline.options('2026-09-15 12:03', now).draft, '2026-09-15 12:05');
});

test('custom deadline selection changes only a draft until confirmation and rejects a time that expires while open', () => {
  let definition;
  const events = [], value = Deadline.after(3600000);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/cmpts/deadline_picker/deadline_picker.js'), 'utf8'), {
    Component: item => { definition = item; }, require: () => Deadline, wx: { hideKeyboard() {} }, Date
  });
  const picker = { ...definition.methods, data: { ...structuredClone(definition.data), value, disabled: false },
    setData(patch) { Object.assign(this.data, patch); }, triggerEvent(name, detail) { events.push({ name, detail }); } };
  picker.open(); picker.selectQuick({ currentTarget: { dataset: { minutes: 180 } } }); picker.close();
  assert.equal(events.length, 0); assert.equal(picker.data.value, value);
  picker.open(); picker.selectQuick({ currentTarget: { dataset: { minutes: 30 } } });
  const selected = picker.data.draft; picker.confirm();
  assert.deepEqual(events, [{ name: 'select', detail: selected }]); assert.equal(picker.data.visible, false);
  picker.open(); picker.data.draft = '2020-01-01 12:00'; picker.confirm();
  assert.equal(events.length, 1); assert.equal(picker.data.visible, true); assert.match(picker.data.error, /重新确认/);
});
