const Deadline = require('../../biz/deadline_biz.js');

Component({
  properties: { value: { type: String, value: '' }, disabled: { type: Boolean, value: false }, lead: { type: Number, value: 0 } },
  data: { visible: false, days: [], hours: [], minutes: [], draft: '', selectedDate: '', selectedHour: '', selectedMinute: '', error: '' },
  methods: {
    open() {
      if (this.data.disabled) return;
      wx.hideKeyboard();
      this.setData({ ...Deadline.options(this.data.value, Date.now(), undefined, undefined, this.data.lead), visible: true, error: '' });
    },
    close() { this.setData({ visible: false, error: '' }); },
    stop() {},
    selectDate(e) { this.setData({ ...Deadline.options(this.data.draft, Date.now(), e.currentTarget.dataset.value, undefined, this.data.lead), error: '' }); },
    selectHour(e) {
      const hour = e.currentTarget.dataset.value;
      if (!this.data.hours.some(item => item.value === hour && !item.disabled)) return;
      this.setData({ ...Deadline.options(this.data.draft, Date.now(), this.data.selectedDate, hour, this.data.lead), error: '' });
    },
    selectMinute(e) {
      const minute = e.currentTarget.dataset.value;
      if (!this.data.minutes.some(item => item.value === minute && !item.disabled)) return;
      this.setData({ selectedMinute: minute, draft: this.data.selectedDate + ' ' + this.data.selectedHour + ':' + minute, error: '' });
    },
    selectQuick(e) { this.setData({ ...Deadline.options(Deadline.after(Number(e.currentTarget.dataset.minutes) * 60000, Date.now(), this.data.lead), Date.now(), undefined, undefined, this.data.lead), error: '' }); },
    confirm() {
      if (!Deadline.valid(this.data.draft, Date.now(), this.data.lead)) {
        this.setData({ ...Deadline.options(this.data.draft, Date.now(), undefined, undefined, this.data.lead), error: this.data.lead > 0 ? '请留出至少 ' + Math.max(1, Math.round(this.data.lead / 60000)) + ' 分钟的配送时间' : '刚才选择的时间已失效，请重新确认' });
        return;
      }
      this.triggerEvent('select', this.data.draft);
      this.close();
    }
  }
});
