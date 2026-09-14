const Deadline = require('../../biz/deadline_biz.js');

Component({
  properties: { value: { type: String, value: '' }, disabled: { type: Boolean, value: false } },
  data: { visible: false, days: [], hours: [], minutes: [], draft: '', selectedDate: '', selectedHour: '', selectedMinute: '', error: '' },
  methods: {
    open() {
      if (this.data.disabled) return;
      wx.hideKeyboard();
      this.setData({ ...Deadline.options(this.data.value), visible: true, error: '' });
    },
    close() { this.setData({ visible: false, error: '' }); },
    stop() {},
    selectDate(e) { this.setData({ ...Deadline.options(this.data.draft, Date.now(), e.currentTarget.dataset.value), error: '' }); },
    selectHour(e) {
      const hour = e.currentTarget.dataset.value;
      if (!this.data.hours.some(item => item.value === hour && !item.disabled)) return;
      this.setData({ ...Deadline.options(this.data.draft, Date.now(), this.data.selectedDate, hour), error: '' });
    },
    selectMinute(e) {
      const minute = e.currentTarget.dataset.value;
      if (!this.data.minutes.some(item => item.value === minute && !item.disabled)) return;
      this.setData({ selectedMinute: minute, draft: this.data.selectedDate + ' ' + this.data.selectedHour + ':' + minute, error: '' });
    },
    selectQuick(e) { this.setData({ ...Deadline.options(Deadline.after(Number(e.currentTarget.dataset.minutes) * 60000)), error: '' }); },
    confirm() {
      if (!Deadline.valid(this.data.draft)) {
        this.setData({ ...Deadline.options(this.data.draft), error: '刚才选择的时间已失效，请重新确认' });
        return;
      }
      this.triggerEvent('select', this.data.draft);
      this.close();
    }
  }
});
