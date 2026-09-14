const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const mini = path.join(root, 'miniprogram');
const project = path.join(root, 'cloudfunctions/mcloud/project/crun');
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const pages = app.pages.filter(page => page.includes('/campus_service/'));

function read(file) {
	return fs.readFileSync(file, 'utf8');
}

function pageSources(file, kind, seen = new Set()) {
	if (seen.has(file)) return '';
	seen.add(file);
	const source = read(file);
	let result = source;
	const imports = kind === 'wxml' ? /<include\s+src=["']([^"']+)["']/g : /require\(\s*["']([^"']+)["']\s*\)/g;
	for (const match of source.matchAll(imports)) {
		let target = path.resolve(path.dirname(file), match[1]);
		if (kind === 'js' && !path.extname(target)) target += '.js';
		// 只展开页面和传入 Page() 的工厂，避免工具库同名方法造成误判。
		const binding = kind === 'js' && source.slice(0, match.index).match(/\b(?:const|let)\s+(\w+)\s*=\s*$/);
		const pageFactory = binding && new RegExp('\\bPage\\s*\\(\\s*' + binding[1] + '\\s*\\(').test(source);
		if (kind === 'js' && !target.startsWith(path.join(mini, 'projects/crun/pages') + path.sep) && !pageFactory) continue;
		assert.ok(fs.existsSync(target), 'Missing page dependency: ' + target);
		if (kind === 'js') {
			const check = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
			assert.equal(check.status, 0, check.stderr);
		}
		result += '\n' + pageSources(target, kind, seen);
	}
	return result;
}

test('all campus service pages are registered with complete page files', () => {
	assert.equal(pages.length, 7);
	assert.equal(new Set(pages).size, pages.length);
	for (const page of pages) {
		for (const ext of ['js', 'json', 'wxml', 'wxss']) {
			assert.ok(fs.existsSync(path.join(mini, page + '.' + ext)), page + '.' + ext);
		}
		JSON.parse(read(path.join(mini, page + '.json')));
		const result = spawnSync(process.execPath, ['--check', path.join(mini, page + '.js')], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
	}
});

test('campus page event handlers and local style imports exist', () => {
	for (const page of pages) {
		const js = pageSources(path.join(mini, page + '.js'), 'js');
		const wxml = pageSources(path.join(mini, page + '.wxml'), 'wxml');
		for (const match of wxml.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g)) {
			const handler = match[1];
			assert.match(js, new RegExp('\\b' + handler + '\\s*(?:[:=]\\s*(?:async\\s+)?function\\s*)?\\('), page + ': missing handler ' + handler);
		}
		const style = path.join(mini, page + '.wxss');
		for (const match of read(style).matchAll(/@import\s+["']([^"']+)["']/g)) {
			assert.ok(fs.existsSync(path.resolve(path.dirname(style), match[1])), page + ': missing style ' + match[1]);
		}
	}
});

test('campus endpoints reference implemented controller methods', () => {
	const routes = read(path.join(project, 'public/route.js'));
	const endpointNames = new Set();
	for (const match of routes.matchAll(/'([^']*campus[^']*)'\s*:\s*'([^'@]+)@([^'#]+)(?:#[^']*)?'/g)) {
		const [, endpoint, controller, method] = match;
		endpointNames.add(endpoint);
		const source = read(path.join(project, 'controller', controller + '.js'));
		assert.match(source, new RegExp('\\b' + method + '\\s*\\('), endpoint);
	}
	assert.ok(endpointNames.has('campus_service/chat'));
	assert.ok(endpointNames.has('admin/campus_chat_reply'));
	for (const page of pages) {
		for (const match of pageSources(path.join(mini, page + '.js'), 'js').matchAll(/["']((?:admin\/campus_|campus_service\/)[a-z_]+)["']/g)) {
			assert.ok(endpointNames.has(match[1]), page + ': missing endpoint ' + match[1]);
		}
	}
});

test('admin home reaches the conversation inbox and service configuration through management', () => {
	const { harness } = require('../test-support/admin-console-harness.cjs');
	const home = harness('index/home/admin_home.js');
	const source = read(path.join(mini, 'projects/crun/pages/admin/index/home/admin_home.wxml'));
	for (const key of ['chats', 'settings']) {
		assert.ok(source.includes('data-key="' + key + '"'));
		home.page.bindNavigate({ currentTarget: { dataset: { key } } });
		assert.equal(home.navigation.at(-1).url, home.UI.ROUTES[key]);
		assert.ok(app.pages.includes(home.navigation.at(-1).url.slice(1)));
	}
	const settings = harness('settings/index/admin_settings.js');
	const serviceEntry = settings.page.data.groups.flatMap(group => group.items).find(item => item.key === 'services');
	assert.ok(serviceEntry, 'Management must expose campus service configuration');
	settings.page.bindNavigate({ currentTarget: { dataset: { key: serviceEntry.key } } });
	assert.equal(settings.navigation.at(-1).url, home.UI.ROUTES.services);
	assert.ok(app.pages.includes(settings.navigation.at(-1).url.slice(1)));
});
