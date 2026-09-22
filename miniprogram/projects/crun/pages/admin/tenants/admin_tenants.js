const UI = require('../../../biz/admin_console_biz.js');
const Ops = require('../../../biz/operations_biz.js');
const Tenant = require('../../../biz/tenant_biz.js');
const Admin = require('../../../../../comm/biz/admin_biz.js');
const lines = value => String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
Page({
  data: { loading:false, busy:false, error:'', schools:[], campuses:[], admins:[], schoolIndex:0, campusIndex:0, adminIndex:0,
    school:null, campus:null, campusLoading:false, campusError:'', adminLoading:false, adminError:'', adminReady:false,
    phaseText:'', pickupText:'', grantText:'', grantManager:false },
  onLoad() { if (UI.start(this, true)) return this.load(); },
  onShow() { this._visible = true; },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  bindBack() { UI.back('settings'); },
  async load() {
    if (!UI.authorize(this, true) || this.data.busy || this.data.loading) return;
    if (!(Admin.getAdminToken() || {}).platform) { this.setData({error:'仅平台管理员可管理学校与授权'}); return; }
    this.setData({loading:true,error:''});
    try {
      const value = await Ops.get('admin/tenant_directory');
      if (this._unloaded) return;
      this._directory = value;
      this.setData({schools:value.schools, admins:value.admins.filter(x=>!x.platform), schoolIndex:0, adminIndex:0});
      await Promise.all([this.selectSchool(value.schools[0] || null), this.selectAdmin(this.data.admins[0])]);
    } catch (error) { if (!this._unloaded) this.setData({error:UI.message(error)}); }
    finally { if (!this._unloaded) this.setData({loading:false}); }
  },
  selectSchool(school) {
    const campuses = school ? this._directory.campuses.filter(x=>x.schoolId===school.schoolId) : [];
    this.setData({school:school ? {...school} : null, campuses, campusIndex:0});
    return this.selectCampus(campuses[0] || null);
  },
  async selectCampus(campus) {
    const generation = this._campusLoad = (this._campusLoad || 0) + 1;
    this._selectedCampus = campus;
    this.setData({campus:null, campusLoading:!!campus && campus.version > 0, campusError:'', phaseText:'', pickupText:''});
    if (!campus) return;
    try {
      const value = campus.version > 0
        ? await Ops.get('admin/tenant_campus_detail', {value:{schoolId:campus.schoolId,campusId:campus.campusId}})
        : campus;
      if (this._unloaded || generation !== this._campusLoad) return;
      const locations = value.locations || {phases:[],pickupStations:[]};
      this.setData({campus:{...value},phaseText:locations.phases.join('\n'),pickupText:locations.pickupStations.map(x=>x.name+' | '+x.list.join('、')).join('\n')});
    } catch (error) {
      if (!this._unloaded && generation === this._campusLoad) this.setData({campusError:UI.message(error)});
    } finally {
      if (!this._unloaded && generation === this._campusLoad) this.setData({campusLoading:false});
    }
  },
  async selectAdmin(admin) {
    const generation = this._adminLoad = (this._adminLoad || 0) + 1;
    this._selectedAdmin = admin;
    this.setData({adminLoading:!!admin,adminReady:false,adminError:'',grantText:'',grantManager:false});
    if (!admin) return;
    try {
      const value = await Ops.get('admin/tenant_account_detail', {adminId:admin._id});
      if (this._unloaded || generation !== this._adminLoad) return;
      this.setData({grantText:value.scopes.map(x=>x.schoolId+'/'+x.campusId).join('\n'),grantManager:value.type===1,adminReady:true});
    } catch (error) {
      if (!this._unloaded && generation === this._adminLoad) this.setData({adminError:UI.message(error)});
    } finally {
      if (!this._unloaded && generation === this._adminLoad) this.setData({adminLoading:false});
    }
  },
  retryCampus() { if (!this.data.busy && !this.data.campusLoading) return this.selectCampus(this._selectedCampus); },
  retryAdmin() { if (!this.data.busy && !this.data.adminLoading) return this.selectAdmin(this._selectedAdmin); },
  schoolChange(e) { if(this.data.busy || this.data.loading)return; const i=Number(e.detail.value); this.setData({schoolIndex:i}); return this.selectSchool(this.data.schools[i]); },
  campusChange(e) { if(this.data.busy || this.data.loading)return; const i=Number(e.detail.value); this.setData({campusIndex:i}); return this.selectCampus(this.data.campuses[i]); },
  adminChange(e) { if(this.data.busy || this.data.loading)return; const i=Number(e.detail.value); this.setData({adminIndex:i}); return this.selectAdmin(this.data.admins[i]); },
  newSchool() { if (!this.data.busy && !this.data.loading) { this.setData({school:{schoolId:'',name:'',enabled:true,version:0},campuses:[]}); return this.selectCampus(null); } },
  newCampus() { if (!this.data.busy && !this.data.loading && this.data.school && this.data.school.version) return this.selectCampus({schoolId:this.data.school.schoolId,campusId:'',name:'',enabled:true,version:0,locations:{phases:[],pickupStations:[]}}); },
  edit(e) {
    const key=e.currentTarget.dataset.key;
    if (this.data.busy || this.data.loading || (key.startsWith('campus.') || ['phaseText','pickupText'].includes(key)) && !this.data.campus
      || ['grantText','grantManager'].includes(key) && !this.data.adminReady) return;
    if (['school.schoolId','school.name','school.enabled','campus.campusId','campus.name','campus.enabled','phaseText','pickupText','grantText','grantManager'].includes(key)) this.setData({[key]:e.detail.value});
  },
  async submit(route,value) {
    if (this.data.busy || this.data.loading) return;
    this.setData({busy:true,error:''});
    try { await Ops.get(route,{value}); wx.showToast({title:'已保存'}); }
    catch (error) { if(!this._unloaded)this.setData({error:UI.message(error)}); return; }
    finally { if (!this._unloaded) this.setData({busy:false}); }
    if (!this._unloaded) { await this.load(); try { await Tenant.directory(()=>Ops.get('tenant/catalog'),true); } catch (_) { /* A saved change is not reported as failed if directory refresh is offline. */ } }
  },
  saveSchool() { const s=this.data.school; if (s) return this.submit('admin/tenant_school_save',{schoolId:s.schoolId,name:s.name,enabled:s.enabled,version:s.version}); },
  saveCampus() {
    const c=this.data.campus; if (!c) return;
    try {
      const pickupStations=lines(this.data.pickupText).map(line=>{const parts=line.split('|'); if(parts.length!==2)throw new Error('自提点每行填写：区域 | 站点1、站点2'); return {name:parts[0].trim(),list:parts[1].split(/[、,，]/).map(x=>x.trim()).filter(Boolean)};});
      return this.submit('admin/tenant_campus_save',{schoolId:c.schoolId,campusId:c.campusId,name:c.name,enabled:c.enabled,version:c.version,locations:{phases:lines(this.data.phaseText),pickupStations}});
    } catch(error) { this.setData({error:UI.message(error)}); }
  },
  saveGrant() {
    if (!this.data.adminReady) return;
    const admin=this.data.admins[this.data.adminIndex]; if(!admin)return;
    try { const scopes=lines(this.data.grantText).map(line=>{const parts=line.split('/'); if(parts.length!==2)throw new Error('每行填写：学校编号/校区编号，全部校区用 *'); return {schoolId:parts[0],campusId:parts[1]};});
      return this.submit('admin/tenant_grant',{adminId:admin._id,scopes,type:this.data.grantManager?1:0});
    } catch(error) { this.setData({error:UI.message(error)}); }
  }
});
