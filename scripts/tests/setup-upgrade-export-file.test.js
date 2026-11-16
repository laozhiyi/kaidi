'use strict';
// 初始化升级：已上线环境（旧版本标记存在）要补建新增集合，再写新标记。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/service/base_project_service.js');
const NEW_MARKER = 'bx_setup_crun_20261116_points';

function harness({ newMarker = false } = {}) {
	const present = new Set(), created = [];
	let seeds = 0;
	const dbUtil = {
		// 旧环境：除新增集合与新标记外，其它集合都存在（旧标记也在）。
		isExistCollection: async name => present.has(name) || newMarker && name === NEW_MARKER
			|| !(name === 'bx_point_log' || name === NEW_MARKER),
		createCollection: async name => { created.push(name); present.add(name); return true; }
	};
	const module = { exports: {} };
	const quiet = { log() { }, error() { }, warn() { } };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
		module, console: quiet, process: { env: {} }, setTimeout, clearTimeout, require(request) {
			if (request.endsWith('/db_util.js')) return dbUtil;
			if (request.endsWith('/utils/util.js')) return { getProjectId: () => 'crun' };
			if (request.endsWith('/admin_model.js')) return { count: async () => 1 };
			if (request.endsWith('/core/app_error.js')) return class AppError extends Error { };
			if (request.endsWith('/service/base_service.js')) return class { };
			if (request.endsWith('/tenant_context.js')) return { system: fn => fn() };
			if (request === './tenant_service.js') return class { async seed() { seeds += 1; } };
			throw new Error('Unexpected dependency: ' + request);
		}
	});
	const Service = module.exports;
	return { service: new Service(), created, seeds: () => seeds, present };
}

test('an initialized environment creates the new point_log collection before writing the new marker', async () => {
	const h = harness();
	await h.service.initSetup();
	// 升级分支只会补建缺失的集合；其它已存在的集合不会再调 createCollection。
	assert.deepEqual(h.created, ['bx_point_log', NEW_MARKER]);
	assert.deepEqual(h.present.has('bx_point_log'), true);
	assert.equal(h.seeds(), 1, '升级分支仍会执行一次 seed（只补学校/校区，不覆盖已有数据）');
});

test('an environment already carrying the new marker skips the upgrade entirely', async () => {
	const h = harness({ newMarker: true });
	await h.service.initSetup();
	assert.deepEqual(h.created, []);
	assert.equal(h.seeds(), 0);
});

test('the old marker alone no longer short-circuits the upgrade', async () => {
	const h = harness();
	// harness 默认旧标记存在、新标记不存在：若代码仍检查旧标记会直接 return，created 为空。
	await h.service.initSetup();
	assert.ok(h.created.includes('bx_point_log'));
});
