const Deadline = require('../../biz/deadline_biz.js');

// 接单截止时间选择器：选择单个时间点，精确到分钟。
Component({
  properties: { 
    value: { type: String, value: '' }, 
    disabled: { type: Boolean, value: false }, 
    formEnd: { type: String, value: '' },  // 期待送达时间段（最早 ~ 最晚），接单截止不能晚于其最晚时间
    lead: { type: Number, value: 0 }      // 配送时长（毫秒），接单截止需留出这段时间
  },
  data: { 
    visible: false, 
    display: '', 
    days: [], 
    hours: Deadline.HOURS, 
    minutes: Deadline.MINUTES,
    point: null,  // 当前选中的时间点
    wheel: [0, 0], 
    manual: '', 
    draft: '', 
    summary: '', 
    error: '' 
  },
  observers: {
    'value, formEnd, lead'() { this._syncDisplay(); }
  },
  lifetimes: { attached() { this._syncDisplay(); } },
  methods: {
    _syncDisplay() {
      const selected = Deadline.parse(this.data.value);
      const range = Deadline.parseRange(this.data.formEnd);
      const timestamp = Number.isFinite(selected) ? selected
        : range ? Deadline.at(range.end) - (this.data.lead || 0) : NaN;
      this.setData({ display: Number.isFinite(timestamp) ? Deadline.label(timestamp) : '' });
    },
    _state(point, error = '', manual) {
      const now = Date.now();
      return {
        point: point || { date: '', hour: '00', minute: '00' },
        error,
        days: Deadline.days(now, 0),
        wheel: [Number(point ? point.hour : '00'), Number(point ? point.minute : '00')],
        manual: manual === undefined ? (point ? point.hour + ':' + point.minute : '00:00') : manual,
        draft: point ? (point.date + ' ' + point.hour + ':' + point.minute) : '',
        summary: point ? Deadline.label(Deadline.at(point)) || '' : ''
      };
    },
    open() {
      if (this.data.disabled) return;
      if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
      let point = null;
      if (this.data.value) {
        point = Deadline.endpoint(Deadline.parse(this.data.value));
      } else {
        // 默认接单截止 = 最晚送达时间 - 配送时长。
        const range = Deadline.parseRange(this.data.formEnd);
        const defaultTs = range ? Deadline.at(range.end) - (this.data.lead || 0)
          : Math.ceil((Date.now() + 10 * Deadline.MINUTE) / Deadline.MINUTE) * Deadline.MINUTE;
        point = Deadline.endpoint(defaultTs);
      }
      this._draft = point;
      this.setData({ visible: true, ...this._state(point) });
    },
    close() { 
      this.setData({ visible: false, error: '' }); 
    },
    stop() {},
    selectDate(e) {
      const day = e.currentTarget.dataset.value;
      const point = { ...this._draft, date: day };
      this._draft = point;
      this.setData(this._state(point));
    },
    wheelChange(e) {
      const [hour, minute] = e.detail.value || [];
      const point = { 
        date: this._draft.date || Deadline.endpoint(Date.now()).date, 
        hour: Deadline.HOURS[hour], 
        minute: Deadline.MINUTES[minute] 
      };
      this._draft = point;
      this.setData(this._state(point));
    },
    manualInput(e) {
      const raw = String(e.detail.value || '').trim().replace(/\s+/g, ' ');
      this.setData({ manual: raw, error: '' });
      const match = raw.match(/^(?:(\d{4}-\d{2}-\d{2}) )?(\d{1,2}):(\d{2})$/);
      if (!match) return;
      const point = { 
        date: match[1] || this._draft.date || Deadline.endpoint(Date.now()).date, 
        hour: Deadline.HOURS[Number(match[2])], 
        minute: Deadline.MINUTES[Number(match[3])] 
      };
      if (!point.hour || !point.minute) return;
      this._draft = point;
      this.setData(this._state(point, '', raw));
    },
    _validate(point) {
      const now = Date.now();
      const ts = Deadline.at(point);
      if (!Number.isFinite(ts)) return '请选择完整的截止时间';
      if (ts <= now) return '接单截止时间须在未来';
      const range = Deadline.parseRange(this.data.formEnd);
      if (range && ts > Deadline.at(range.end)) return '接单截止时间不能晚于最晚送达时间';
      if (range && ts + (this.data.lead || 0) > Deadline.at(range.end)) return '接单截止与最晚送达时间之间需要留足配送时长';
      return '';
    },
    confirm() {
      const point = this._draft;
      const error = this._validate(point);
      if (error) { 
        this.setData({ error }); 
        return; 
      }
      const timeText = point.date + ' ' + point.hour + ':' + point.minute;
      this.triggerEvent('select', timeText);
      this.close();
    }
  }
});
