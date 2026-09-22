'use strict';
const AppError=require('../../../../framework/core/app_error.js');
// Code-owned, pure rules. Only the core owns transactions, actor checks,
// state transitions, idempotency, quotas and notifications.
const list=[require('./take.js'),require('./send.js'),require('./buy.js')];
const services=Object.freeze(Object.fromEntries(list.map(plugin=>[plugin.key,Object.freeze(plugin)])));
function get(key){if(!Object.prototype.hasOwnProperty.call(services,key))throw new AppError('服务类型无效');return services[key];}
module.exports={services,get};
