'use strict';
const Base = require('./base_project_controller.js');
const Reputation = require('../service/reputation_service.js');
class ReputationController extends Base {
  async summary() { return new Reputation().summary(this._userId); }
  async records() {
    const input = this.validateData({ source: 'string|default=review|max:10', page: 'int|default=1|min:1|max:500', size: 'int|default=20|min:1|max:50' });
    return new Reputation().records(this._userId, input);
  }
}
module.exports = ReputationController;
