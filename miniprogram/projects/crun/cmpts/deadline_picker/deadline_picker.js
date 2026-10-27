const Deadline = require('../../biz/deadline_biz.js');

// 期待送达时间 = 「最早 ~ 最晚」时间段，支持滚轮与手动输入，精确到分钟。
Component({
  properties: { value: { type: String, value: '' }, disabled: { type: Boolean, value: false }, lead: { type: Number, value: 0 } },
  data: { visible: false, display: '', active: 'start', days: [], hours: Deadline.HOURS, minutes: Deadline.MINUTES,
    start: null, end: null, wheel: [0, 0], manual: '', draft: '', summary: '', error: '', quicks: Deadline.quickOptions() },
  observers: {
    value() { this._syncDisplay(); },
    // 配送时长是异步从运营配置里拿到的：拿到后重算日期与合法区间，避免默认值已经过期。
    lead(lead) {
      this.setData({ days: Deadline.days(Date.now(), lead), quicks: Deadline.quickOptions(Date.now(), lead) });
      if (this.data.visible && this._draft) this._apply(Deadline.normalize(Deadline.rangeText(this._draft), Date.now(), lead));
    }
  },
  lifetimes: { attached() { this._syncDisplay(); } },
  methods: {
    _syncDisplay() {
      const parsed = Deadline.parseRange(this.data.value);
      this.setData({ display: parsed ? Deadline.rangeLabel(parsed) : '' });
    },
    _state(range, active, error = '', manual) {
      const now = Date.now();
      const point = range[active] || range.start;
      return {
        start: range.start, end: range.end, active, error,
        days: Deadline.days(now, this.data.lead),
        quicks: Deadline.quickOptions(now, this.data.lead),
        wheel: [Number(point.hour), Number(point.minute)],
        manual: manual === undefined ? point.hour + ':' + point.minute : manual,
        draft: Deadline.rangeText(range),
        summary: Deadline.rangeLabel(range) + ' · 在此区间内送达不算超时'
      };
    },
    open() {
      if (this.data.disabled) return;
      if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
      this._draft = Deadline.normalize(this.data.value, Date.now(), this.data.lead);
      this.setData({ visible: true, ...this._state(this._draft, 'start') });
    },
    close() { this.setData({ visible: false, error: '' }); },
    stop() {},
    // 先选「最早」还是「最晚」：切换端点后滚轮与手动输入都跟随当前端点。
    selectEndpoint(e) {
      const active = e.currentTarget.dataset.field === 'end' ? 'end' : 'start';
      this.setData(this._state(this._draft, active));
    },
    selectQuick(e) { this._apply(Deadline.quickRange(Number(e.currentTarget.dataset.minutes) || 0, Date.now(), this.data.lead)); },
    selectDate(e) {
      const day = e.currentTarget.dataset.value;
      const range = { start: { ...this._draft.start }, end: { ...this._draft.end } };
      range[this.data.active].date = day;
      // 日期是区间的骨架：起点日期永远不晚于终点日期。
      if (this.data.active === 'start' && range.start.date > range.end.date) range.end.date = range.start.date;
      if (this.data.active === 'end' && range.end.date < range.start.date) range.end.date = range.start.date;
      this._apply(range);
    },
    wheelChange(e) {
      const [hour, minute] = e.detail.value || [];
      const point = { date: this._draft[this.data.active].date, hour: Deadline.HOURS[hour], minute: Deadline.MINUTES[minute] };
      this._apply(this._withPoint(this.data.active, point));
    },
    // 手动输入支持 "13:30" 与 "2026-10-30 13:30" 两种写法。
    manualInput(e) {
      const raw = String(e.detail.value || '').trim().replace(/\s+/g, ' ');
      this.setData({ manual: raw, error: '' });
      const match = raw.match(/^(?:(\d{4}-\d{2}-\d{2}) )?(\d{1,2}):(\d{2})$/);
      if (!match) return;
      const point = { date: match[1] || this._draft[this.data.active].date, hour: Deadline.HOURS[Number(match[2])], minute: Deadline.MINUTES[Number(match[3])] };
      if (!point.hour || !point.minute) return;
      this._apply(this._withPoint(this.data.active, point), true);
    },
    // 区间始终有序：改动一端时把另一端推到合理位置，避免出现反向区间。
    _withPoint(field, point) {
      const range = { start: { ...this._draft.start }, end: { ...this._draft.end } };
      range[field] = point;
      const start = Deadline.at(range.start), end = Deadline.at(range.end);
      if (field === 'start') {
        if (end - start < Deadline.MIN_SPAN) range.end = Deadline.endpoint(start + 30 * Deadline.MINUTE);
      } else if (end - start < Deadline.MIN_SPAN) {
        const moved = end - 30 * Deadline.MINUTE;
        if (Deadline.at(range.start) > moved) range.start = Deadline.endpoint(Math.max(0, moved));
      }
      return range;
    },
    _apply(range, keepManual = false) {
      const error = Deadline.validate(range, Date.now(), this.data.lead);
      this._draft = range;
      // 输入过程中的越界先提示、不强行改写用户输入，确认时再拦截。
      this.setData(this._state(range, this.data.active, error, keepManual ? this.data.manual : undefined));
    },
    confirm() {
      const range = this._draft;
      const error = Deadline.validate(range, Date.now(), this.data.lead);
      if (error) { this.setData({ error }); return; }
      this.triggerEvent('select', Deadline.rangeText(range));
      this.close();
    }
  }
});
