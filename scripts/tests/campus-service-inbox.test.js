const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function load(messages, services) {
	const value = (row, field) => field.split('.').reduce((obj, key) => obj && obj[key], row);
	const evaluate = (expr, row) => {
		if (typeof expr === 'string' && expr.startsWith('$')) return value(row, expr.slice(1));
		if (!expr || typeof expr !== 'object') return expr;
		if (expr.op === 'eq') return evaluate(expr.args[0], row) === evaluate(expr.args[1], row);
		if (expr.op === 'and') return expr.args.every(item => evaluate(item, row));
		if (expr.op === 'cond') return evaluate(expr.args.if, row) ? expr.args.then : expr.args.else;
		throw new Error('Unexpected expression ' + JSON.stringify(expr));
	};
	const matches = (row, where) => where.or ? where.or.some(item => matches(row, item)) :
		Object.entries(where).every(([key, expected]) => expected.regexp !== undefined ?
			new RegExp(expected.regexp, expected.options).test(value(row, key)) : value(row, key) === expected);
	const operators = Object.fromEntries(['first', 'sum', 'cond', 'and', 'eq'].map(op => [op, args => ({ op, args })]));
	const db = {
		command: { aggregate: operators, or: or => ({ or }) },
		RegExp: options => options,
		collection(name) {
			assert.equal(name, 'bx_campus_service_message');
			return { aggregate() {
				let rows = messages.map(row => ({ ...row }));
				return {
					match(where) { rows = rows.filter(row => matches(row, where)); return this; },
					sort(order) {
						rows.sort((a, b) => {
							for (const [key, direction] of Object.entries(order)) {
								if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * direction;
							}
							return 0;
						}); return this;
					},
					group(fields) {
						const groups = new Map();
						for (const row of rows) {
							const id = evaluate(fields._id, row);
							const first = !groups.has(id);
							const group = groups.get(id) || { _id: id };
							for (const [key, expr] of Object.entries(fields)) {
								if (key === '_id') continue;
								if (expr.op === 'first' && first) group[key] = evaluate(expr.args, row);
								if (expr.op === 'sum') group[key] = (group[key] || 0) + evaluate(expr.args, row);
							}
							groups.set(id, group);
						}
						rows = [...groups.values()]; return this;
					},
					lookup({ from, localField, foreignField, as }) {
						assert.equal(from, 'bx_campus_service');
						rows.forEach(row => { row[as] = services.filter(service => service[foreignField] === row[localField]); }); return this;
					},
					unwind(field) {
						const key = field.slice(1);
						rows = rows.flatMap(row => row[key].map(item => ({ ...row, [key]: item }))); return this;
					},
					count(field) { rows = rows.length ? [{ [field]: rows.length }] : []; return this; },
					skip(count) { rows = rows.slice(count); return this; },
					limit(count) { rows = rows.slice(0, count); return this; },
					async end() { return { list: rows }; }
				};
			} };
		}
	};
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/model/campus_service_message_model.js'), 'utf8'), {
		module, require(name) {
			if (name.includes('cloud_base')) return { getCloud: () => ({ database: () => db }) };
			if (name === './campus_service_model.js') return { CL: 'bx_campus_service' };
			return class { static C(name) { return 'bx_' + name; } };
		}
	});
	return module.exports;
}

test('inbox aggregation preserves old sessions, counts all unread and paginates after grouping', async () => {
	const services = [{ _id: 'svc', _pid: 'crun', CS_CAMPUS: '育才校区', CS_NAME: '客服' }];
	const messages = Array.from({ length: 1100 }, (_, i) => ({
		_pid: 'crun', CSM_ID: String(i), CSM_ADD_TIME: i,
		CSM_SESSION_ID: i ? 'new' : 'old', CSM_SERVICE_ID: 'svc', CSM_USER_ID: 'user',
		CSM_CONTENT: String(i), CSM_SENDER: 'user', CSM_READ: 0
	}));
	messages.push({ ...messages[0], _pid: 'other', CSM_SESSION_ID: 'foreign' });
	const model = load(messages, services);
	const first = await model.getSessionList('crun', '', 1, 1);
	assert.equal(first.total, 2);
	assert.equal(first.count, 2);
	assert.equal(first.list[0]._id, 'new');
	assert.equal(first.list[0].unread, 1099);
	assert.equal(first.list[0].lastContent, '1099');
	const second = await model.getSessionList('crun', '', 2, 1);
	assert.equal(second.list[0]._id, 'old');
	assert.equal(second.list[0].unread, 1);
});

test('inbox searches literal text and excludes missing or foreign-project services', async () => {
	const services = [
		{ _id: 'svc', _pid: 'crun', CS_CAMPUS: '王城校区', CS_NAME: '客服[1]' },
		{ _id: 'foreign', _pid: 'other', CS_CAMPUS: '王城校区', CS_NAME: '客服[1]' }
	];
	const messages = ['svc', 'missing', 'foreign'].map(id => ({
		_pid: 'crun', CSM_SESSION_ID: id, CSM_SERVICE_ID: id, CSM_ADD_TIME: 1,
		CSM_USER_ID: 'user', CSM_SENDER: 'admin', CSM_READ: 0
	}));
	const model = load(messages, services);
	assert.equal((await model.getSessionList('crun', '[1]', 1, 20)).total, 1);
	assert.equal((await model.getSessionList('crun', '.*', 1, 20)).total, 0);
	assert.equal((await model.getSessionList('crun', '雁山', 1, 20)).total, 0);
});
