'use strict';
const store = require('./operation_store.js');
const context = require('../../../framework/tenancy/tenant_context.js');
const AppError = require('../../../framework/core/app_error.js');
const seed = require('./tenant_defaults.js');
const id = (value, label) => { if (typeof value !== 'string' || !context.ID.test(value)) throw new AppError(label + '须为2至48位小写字母、数字、下划线或连字符，以字母开头'); return value; };
const name = (value, label, max = 30) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AppError(label + '不能为空且不能超过' + max + '字'); return value.trim(); };
const campusKey = (schoolId, campusId) => store.key('campus', schoolId, campusId);
class TenantService {
  async seed() {
    return context.system(() => store.transaction(async tx => {
      if (await store.get(tx, 'school', seed.schoolId)) return;
      const legacy = await store.get(tx,'operation_config',store.key('crun','config'));
      const now = Date.now();
      await store.set(tx, 'school', seed.schoolId, { _pid: 'crun', schoolId: seed.schoolId, name: seed.name, enabled: true, registrationReview: !!(legacy && legacy.value && legacy.value.registrationReview), version: 1, updatedAt: now });
      for (const campus of seed.campuses) await store.set(tx, 'campus', campusKey(seed.schoolId, campus.campusId), {
        _pid: 'crun', schoolId: seed.schoolId, ...campus, enabled: true, locations: seed.locations, version: 1, updatedAt: now
      });
    }));
  }
  async catalog() {
    const db = store.database(), read = async collection => {
      const rows = []; let after = '';
      do {
        const page = await db.collection(store.collection(collection)).where({ _pid: 'crun', ...(after ? { _id: db.command.gt(after) } : {}) })
          .field({schoolId:true,campusId:true,name:true,enabled:true,version:true,updatedAt:true}).orderBy('_id', 'asc').limit(100).get();
        rows.push(...page.data);
        if (page.data.length < 100) return rows;
        if (rows.length >= 5000) throw new AppError('学校目录过大，请联系管理员拆分入口');
        after = page.data[page.data.length - 1]._id;
      } while (true);
    };
    const [schools, campuses] = await Promise.all([read('school'), read('campus')]);
    // Names/status are public directory metadata. Retaining disabled entries
    // lets an administrator log in and reopen the final disabled campus.
    const schoolIds = new Set(schools.map(row => row.schoolId));
    return { schools: schools.map(row => ({ schoolId: row.schoolId, name: row.name, enabled: row.enabled === true })),
      campuses: campuses.filter(row => schoolIds.has(row.schoolId)).map(row => ({ schoolId: row.schoolId, campusId: row.campusId, name: row.name, enabled: row.enabled === true, version: row.version })),
      version: Math.max(0, ...schools.map(row => row.updatedAt || 0), ...campuses.map(row => row.updatedAt || 0)) };
  }
  async resolve(value, {allowDisabled=false} = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('请更新小程序并选择学校和校区');
    const schoolId = id(value.schoolId, '学校编号'), campusId = id(value.campusId, '校区编号');
    const db = store.database();
    const [school, campus] = await Promise.all([store.get(db, 'school', schoolId), store.get(db, 'campus', campusKey(schoolId, campusId))]);
    if (!school || school._pid !== 'crun' || !allowDisabled && school.enabled !== true || !campus || campus._pid !== 'crun' || campus.schoolId !== schoolId || campus.campusId !== campusId || !allowDisabled && campus.enabled !== true) throw new AppError('学校或校区不存在或已停用，请重新选择');
    return { schoolId, campusId, schoolName: school.name, campusName: campus.name, school, campus };
  }
  _platform(admin) { if (!admin || admin.ADMIN_STATUS !== 1 || admin.ADMIN_TYPE !== 1 || admin.ADMIN_PLATFORM !== true) throw new AppError('仅平台管理员可管理学校目录与授权'); }
  async adminDirectory(admin) {
    this._platform(admin);
    const db = store.database();
    const read = async (collection, fields) => {
      const all = []; let after = '';
      do {
        const result = await db.collection(store.collection(collection))
          .where({ _pid: 'crun', ...(after ? { _id: db.command.gt(after) } : {}) })
          .field(fields).orderBy('_id', 'asc').limit(100).get();
        all.push(...result.data);
        if (result.data.length < 100) return all;
        after = result.data[result.data.length - 1]._id;
        if (all.length >= 5000) throw new AppError('目录过大，请联系管理员拆分入口');
      } while (true);
    };
    // Directory responses stay small: location lists and scope grants are
    // loaded only for the selected item. Passwords/tokens are never fetched.
    const [schools, campuses, admins] = await Promise.all([
      read('school', {schoolId:true,name:true,enabled:true,registrationReview:true,version:true}),
      read('campus', {schoolId:true,campusId:true,name:true,enabled:true,version:true}),
      read('admin', {ADMIN_NAME:true,ADMIN_PLATFORM:true,ADMIN_TYPE:true,ADMIN_STATUS:true})
    ]);
    return { schools, campuses, admins: admins.map(row => this._adminSummary(row)) };
  }
  _adminSummary(row) {
    return {_id:row._id,name:row.ADMIN_NAME,platform:row.ADMIN_PLATFORM===true,type:row.ADMIN_TYPE,status:row.ADMIN_STATUS};
  }
  async adminCampusDetail(admin, value) {
    this._platform(admin);
    return (await this.resolve(value, {allowDisabled:true})).campus;
  }
  async adminAccountDetail(admin, adminId) {
    this._platform(admin);
    if (typeof adminId !== 'string' || !adminId || adminId.length > 128) throw new AppError('管理员编号无效');
    const db=store.database();
    const rows=await db.collection(store.collection('admin')).where({_pid:'crun',_id:adminId})
      .field({ADMIN_NAME:true,ADMIN_PLATFORM:true,ADMIN_TYPE:true,ADMIN_STATUS:true,ADMIN_SCOPES:true}).limit(1).get();
    const row=rows.data[0];
    if (!row) throw new AppError('管理员不存在');
    return {...this._adminSummary(row),scopes:row.ADMIN_SCOPES || []};
  }
  async saveSchool(admin, value) {
    this._platform(admin); const schoolId = id(value.schoolId, '学校编号'), title = name(value.name, '学校名称', 60);
    if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.version) || value.version < 0) throw new AppError('学校状态或版本无效');
    return store.transaction(async tx => {
      const actor = await store.get(tx, 'admin', admin._id); this._platform(actor);
      const old = await store.get(tx, 'school', schoolId);
      if ((old && old.version || 0) !== value.version) throw new AppError('学校配置已更新，请刷新后再保存');
      if(value.registrationReview!==undefined && typeof value.registrationReview!=='boolean')throw new AppError('学校注册审核开关无效');
      const next = { _pid: 'crun', schoolId, name: title, enabled: value.enabled, registrationReview:value.registrationReview===undefined ? !!(old && old.registrationReview) : value.registrationReview, version: value.version + 1, updatedAt: Date.now() };
      await store.set(tx, 'school', schoolId, next);
      await store.set(tx, 'operation_audit', store.key('school', schoolId, next.version), { _pid: 'crun', adminId: admin._id, action: 'school_config', targetSchoolId: schoolId, before: old, after: next, createdAt: Date.now() });
      return next;
    });
  }
  locations(value) {
    if (!value || !Array.isArray(value.phases) || !Array.isArray(value.pickupStations) || value.phases.length > 100 || value.pickupStations.length > 100) throw new AppError('地点配置无效，每类最多100项');
    const phases = [...new Set(value.phases.map(item => name(item, '区域名称', 30)))];
    const pickupStations = value.pickupStations.map(item => {
      if (!item || !Array.isArray(item.list) || !item.list.length || item.list.length > 100) throw new AppError('每个自提区域需配置1至100个站点');
      return { name: name(item.name, '自提区域', 30), list: [...new Set(item.list.map(point => name(point, '站点名称', 40)))] };
    });
    if (JSON.stringify({ phases, pickupStations }).length > 40000) throw new AppError('地点配置过大');
    return { phases, pickupStations };
  }
  async saveCampus(admin, value) {
    this._platform(admin); const schoolId = id(value.schoolId, '学校编号'), campusId = id(value.campusId, '校区编号');
    const title = name(value.name, '校区名称'), locations = this.locations(value.locations);
    if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.version) || value.version < 0) throw new AppError('校区状态或版本无效');
    return store.transaction(async tx => {
      this._platform(await store.get(tx, 'admin', admin._id));
      if (!await store.get(tx, 'school', schoolId)) throw new AppError('请先创建学校');
      const key = campusKey(schoolId, campusId), old = await store.get(tx, 'campus', key);
      if ((old && old.version || 0) !== value.version) throw new AppError('校区配置已更新，请刷新后再保存');
      const next = { _pid: 'crun', schoolId, campusId, name: title, enabled: value.enabled, locations, version: value.version + 1, updatedAt: Date.now() };
      await store.set(tx, 'campus', key, next);
      await store.set(tx, 'operation_audit', store.key('campus', key, next.version), { _pid: 'crun', adminId: admin._id, action: 'campus_config', targetSchoolId: schoolId, targetCampusId: campusId, before: old, after: next, createdAt: Date.now() });
      return next;
    });
  }
  async grantAdmin(admin, value) {
    this._platform(admin);
    if (!value || typeof value.adminId !== 'string' || !Array.isArray(value.scopes) || value.scopes.length > 100 || ![0,1].includes(value.type)) throw new AppError('管理员授权无效');
    const scopes = value.scopes.map(grant => ({ schoolId: id(grant.schoolId, '学校编号'), campusId: grant.campusId === '*' ? '*' : id(grant.campusId, '校区编号') }));
    return store.transaction(async tx => {
      this._platform(await store.get(tx, 'admin', admin._id));
      const target = await store.get(tx, 'admin', value.adminId);
      if (!target || target._pid !== 'crun' || target.ADMIN_PLATFORM) throw new AppError('目标管理员不存在或为平台管理员');
      for (const grant of scopes) {
        if (!await store.get(tx, 'school', grant.schoolId) || grant.campusId !== '*' && !await store.get(tx, 'campus', campusKey(grant.schoolId, grant.campusId))) throw new AppError('授权学校或校区不存在');
      }
      await store.set(tx, 'admin', value.adminId, { ...target, ADMIN_TYPE:value.type, ADMIN_SCOPES: scopes, ADMIN_EDIT_TIME: Date.now(), ADMIN_TOKEN: '', ADMIN_TOKEN_TIME: 0 });
      await store.set(tx, 'operation_audit', store.key('grant', value.adminId, Date.now(), admin._id), { _pid: 'crun', adminId: admin._id, action: 'admin_scope', targetAdminId: value.adminId, before: target.ADMIN_SCOPES || [], after: scopes, createdAt: Date.now() });
      return { ok: true };
    });
  }
}
TenantService.campusKey = campusKey;
module.exports = TenantService;
