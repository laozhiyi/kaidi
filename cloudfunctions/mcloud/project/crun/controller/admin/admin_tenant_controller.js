'use strict';
const Base = require('./base_project_admin_controller.js');
const Service = require('../../service/tenant_service.js');
class AdminTenantController extends Base {
  async directory() { await this.isSuperAdmin(); return new Service().adminDirectory(this._admin); }
  async campusDetail() { await this.isSuperAdmin(); const p = this.validateData({ value: 'must|object' }); return new Service().adminCampusDetail(this._admin, p.value); }
  async accountDetail() { await this.isSuperAdmin(); const p = this.validateData({ adminId: 'must|string|max:128' }); return new Service().adminAccountDetail(this._admin, p.adminId); }
  async saveSchool() { await this.isSuperAdmin(); const p = this.validateData({ value: 'must|object' }); return new Service().saveSchool(this._admin, p.value); }
  async saveCampus() { await this.isSuperAdmin(); const p = this.validateData({ value: 'must|object' }); return new Service().saveCampus(this._admin, p.value); }
  async grantAdmin() { await this.isSuperAdmin(); const p = this.validateData({ value: 'must|object' }); return new Service().grantAdmin(this._admin, p.value); }
}
module.exports = AdminTenantController;
