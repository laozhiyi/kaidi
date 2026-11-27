'use strict';
// 微信审核按代码包扫描隐私接口并要求在“用户隐私保护指引”中声明。
// 小程序没有真实业务场景的接口不得出现在代码中，否则声明会因“不符合接口使用场景”被驳回。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const root = path.resolve(__dirname, '../../miniprogram');
const UNUSED_PRIVACY_APIS = ['addPhoneCalendar', 'addPhoneRepeatCalendar', 'getClipboardData'];

function sourceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'miniprogram_npm' ? [] : sourceFiles(full);
		return /\.(js|wxml|wxs)$/.test(entry.name) ? [full] : [];
	});
}

test('小程序代码不调用未声明业务场景的日历和读取剪贴板隐私接口', () => {
	const hits = [];
	for (const file of sourceFiles(root)) {
		const text = fs.readFileSync(file, 'utf8');
		for (const api of UNUSED_PRIVACY_APIS) {
			if (new RegExp('\\b' + api + '\\b').test(text)) hits.push(path.relative(root, file) + ': ' + api);
		}
	}
	assert.deepEqual(hits, []);
});
