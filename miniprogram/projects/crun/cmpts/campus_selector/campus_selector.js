const Tenant = require('../../biz/tenant_biz.js');
const cloud = require('../../../../helper/cloud_helper.js');
Component({
  properties: { disabled: { type: Boolean, value: false }, admin: { type: Boolean, value: false }, reload: { type: Boolean, value: true } },
  data: { schools: [], campuses: [], schoolIndex: 0, campusIndex: 0, loading: true, error: '' },
  lifetimes: {
    attached() { this.load(); this._stop = Tenant.subscribe(() => this.sync()); },
    detached() { this._detached = true; if (this._stop) this._stop(); }
  },
  methods: {
    async load() {
      this.setData({ loading: true, error: '' });
      try {
        this._directory = await Tenant.directory(async () => (await cloud.callCloudSumbit('tenant/catalog', {}, { hint: false })).data, true);
        if (this._detached) return;
        const saved = Tenant.snapshot();
        const available = this.available();
        if (!saved && available.campuses.length) Tenant.select(available.campuses[0], { reload: false, allowDisabled: this.data.admin });
        this.sync();
      } catch (error) { if (!this._detached) this.setData({ error: error.message || '目录加载失败' }); }
      finally { if (!this._detached) this.setData({ loading: false }); }
    },
    available() {
      const all = this._directory || { schools: [], campuses: [] };
      const schools = all.schools.filter(row => this.data.admin || row.enabled !== false);
      const campuses = all.campuses.filter(row => (this.data.admin || row.enabled !== false) && schools.some(school => school.schoolId === row.schoolId));
      return { schools: schools.filter(row => campuses.some(campus => campus.schoolId === row.schoolId)), campuses };
    },
    sync() {
      if (!this._directory || this._detached) return;
      const selected = Tenant.snapshot(), available = this.available(), schools = available.schools;
      if (!schools.length) { this.setData({ schools: [], campuses: [], error: '暂无开放校区，请稍后重试' }); return; }
      const schoolIndex = Math.max(0, schools.findIndex(row => selected && row.schoolId === selected.schoolId));
      const campuses = available.campuses.filter(row => row.schoolId === schools[schoolIndex].schoolId);
      const active = available.campuses.some(row => selected && row.schoolId === selected.schoolId && row.campusId === selected.campusId);
      this.setData({ schools, campuses, schoolIndex, campusIndex: active ? Math.max(0, campuses.findIndex(row => selected && row.campusId === selected.campusId)) : -1, error: active ? '' : '原校区已停用，请重新选择' });
    },
    schoolChange(event) {
      const school = this.data.schools[Number(event.detail.value)];
      if (school) this.choose(this.available().campuses.find(row => row.schoolId === school.schoolId));
    },
    campusChange(event) { this.choose(this.data.campuses[Number(event.detail.value)]); },
    choose(value) { if (this.data.disabled || !value) return; try { Tenant.select(value, { allowDisabled: this.data.admin, reload:this.data.reload }); this.sync(); this.triggerEvent('change', Tenant.snapshot()); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } }
  }
});
