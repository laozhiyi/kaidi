'use strict';
const Base = require('./base_project_controller.js');
const Service = require('../service/tenant_service.js');
class TenantController extends Base { async catalog() { return new Service().catalog(); } }
module.exports = TenantController;
