'use strict';
const context = require('./tenant_context.js');
const AppError = require('../core/app_error.js');

// Account profiles are shared within a school. Operational data is campus scoped.
// Administrator authentication and the directory use explicit service authorization.
const SCHOOL = new Set(['user', 'identity_unique']);
const GLOBAL = new Set(['admin', 'school', 'campus', 'tenant_migration', 'request_scope', 'admin_limit', 'account_session', 'account_media', 'account_cleanup_file']);
function kind(name) {
  const short = name.replace(/^bx_/, '');
  return GLOBAL.has(short) || /^setup_crun(?:_|$)/.test(short) ? 'global' : SCHOOL.has(short) ? 'school' : 'campus';
}
function policy(name) {
  const scope = context.current();
  if (scope && scope.mode === 'system') return null;
  const level = kind(name);
  if (level === 'global') return null;
  return context.fields(level);
}
function belongs(row, filter) { return !filter || !!row && Object.entries(filter).every(([key, value]) => row[key] === value); }
function stamp(data, filter) {
  if (!filter) return data;
  if (Array.isArray(data)) return data.map(row => stamp(row, filter));
  for (const [key, value] of Object.entries(filter)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== value) throw new AppError('不能修改记录所属的学校或校区');
    if (Object.keys(data).some(field => field.startsWith(key + '.'))) throw new AppError('范围字段不可修改');
  }
  return { ...data, ...filter };
}
function missing(error) { return error && (/DOCUMENT_NOT_FOUND|document does not exist/i.test(error.code || error.message || '') || error.errCode === -1 && /not exist|not found/i.test(error.errMsg || error.message || '')); }
function rowOf(result) { return result && (Array.isArray(result.data) ? result.data[0] : result.data); }

function wrap(raw, root = raw, inTransaction = false, reads = new Map()) {
  const command = root.command || raw.command;
  function scopedCollection(name) {
    const filter = policy(name), base = raw.collection(name);
    const where = value => filter ? command.and([value || {}, filter]) : value || {};
    function query(target, constrained = false) {
      return new Proxy(target, { get(object, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'where') return value => query(object.where(where(value)), true);
        if (prop === 'doc') return id => document(id);
        if (prop === 'add') return options => base.add({ ...options, data: stamp(options.data, filter) });
        if (prop === 'aggregate') return () => aggregate(filter ? base.aggregate().match(filter) : base.aggregate());
        if (['get', 'count', 'update', 'remove'].includes(prop)) return (...args) => {
          const effective = constrained || !filter ? object : object.where(filter);
          if (prop === 'update') args[0] = { ...args[0], data: stamp(args[0].data, filter) };
          return effective[prop](...args);
        };
        if (typeof object[prop] === 'function') return (...args) => {
          // Inject before field/order/limit: some SDK query objects cannot add
          // a condition after terminal projection methods.
          const effective = constrained || !filter ? object : object.where(filter);
          return query(effective[prop](...args), true);
        };
        return object[prop];
      }});
    }
    function aggregate(target) {
      return new Proxy(target, { get(object, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'end') return (...args) => object.end(...args);
        if (prop === 'lookup') return spec => {
          // A lookup must independently constrain the foreign collection.
          const foreign = policy(spec.from);
          if (!foreign) return aggregate(object.lookup(spec));
          // Nested raw pipelines could contain additional unscoped lookups.
          // The application only needs simple equality joins. Fail closed for
          // pipelines until a recursive validator is explicitly added.
          if (spec.pipeline) throw new AppError('关联查询请使用受限字段连接');
          const a = command.aggregate;
          if (!a || !a.pipeline || !a.eq) throw new AppError('当前查询不支持安全的关联，请使用独立查询');
          return aggregate(object.lookup({ from: spec.from, as: spec.as, let: { scopedJoinValue: '$' + spec.localField },
            pipeline: a.pipeline().match({ ...foreign, $expr: a.eq(['$' + spec.foreignField, '$$scopedJoinValue']) }).done() }));
        };
        if (['unionWith', 'graphLookup', 'out', 'merge'].includes(prop) && filter) return () => { throw new AppError('不支持跨范围聚合'); };
        if (typeof object[prop] === 'function') return (...args) => aggregate(object[prop](...args));
        return object[prop];
      }});
    }
    function document(id) {
      const doc = base.doc(id), cacheKey = name + '/' + id;
      async function inspect() {
        if (inTransaction && reads.has(cacheKey)) return reads.get(cacheKey);
        let result;
        try { result = await doc.get(); } catch (error) { if (!missing(error)) throw error; result = { data: null }; }
        const row = rowOf(result) || null;
        if (inTransaction) reads.set(cacheKey, row);
        return row;
      }
      async function mutate(method, options) {
        if (!filter) return doc[method](options);
        if (!inTransaction) return root.runTransaction(tx => wrap(tx, root, true).collection(name).doc(id)[method](options), 0);
        const old = await inspect();
        if (old && !belongs(old, filter)) throw new AppError('记录不存在或不属于当前校区');
        if (!old && method !== 'set') throw new AppError('记录不存在');
        if (method === 'remove') { reads.set(cacheKey, null); return doc.remove(); }
        const data = stamp(options.data, filter);
        reads.set(cacheKey, { ...(method === 'update' ? old : {}), ...data, _id: id });
        return doc[method]({ ...options, data });
      }
      return {
        async get() {
          const row = await inspect();
          return { data: belongs(row, filter) ? row : null };
        },
        set: options => mutate('set', options), update: options => mutate('update', options), remove: () => mutate('remove')
      };
    }
    return query(base);
  }
  return new Proxy(raw, { get(object, prop) {
    if (prop === 'collection') return scopedCollection;
    if (prop === 'runTransaction') return (work, retries = 0) => object.runTransaction(tx => work(wrap(tx, root, true)), retries);
    if (prop === 'startTransaction') return async () => wrap(await object.startTransaction(), root, true);
    const value = object[prop];
    return typeof value === 'function' ? value.bind(object) : value;
  }});
}
module.exports = { wrap, kind, belongs, stamp };
