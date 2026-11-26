'use strict';
// 仓库卫生检查：防止日志、临时产物、密钥、过程文档进入 GitHub。
// 规则说明见 CONTRIBUTING.md 第二、三节；需要放宽时同步修改该文档。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const ROOT_DIRS = new Set(['miniprogram', 'cloudfunctions', 'scripts', 'docs', 'deployment', '.github']);
const ROOT_FILES = new Set(['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore', 'project.config.json']);
const MAX_BYTES = 1024 * 1024;
const PROCESS_WORDS = ['本轮', '本次已', '本次未', '按用户要求', '尚未上传', '未执行云端', '未执行真机'];

// 即将被 `git add -A` 提交的全部文件：已跟踪的 + 未被忽略的新文件。
function candidateFiles() {
	let out;
	try {
		out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	} catch (e) { return null; }
	return out.split('\0').filter(Boolean).filter(f => fs.existsSync(path.join(root, f)));
}
const files = candidateFiles();
const opts = { skip: files ? false : '不在 git 仓库中' };
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const docs = () => files.filter(f => /^docs\/[^/]+\.md$/.test(f));

test('仓库根目录只包含约定的目录和文件', opts, () => {
	const bad = files.filter(f => {
		const [first, ...rest] = f.split('/');
		return rest.length ? !ROOT_DIRS.has(first) : !ROOT_FILES.has(first);
	});
	assert.deepEqual(bad, [], '不在白名单内，临时文件请放进 .tmp/，新增根目录内容见 CONTRIBUTING.md');
});

test('不提交日志、备份、压缩包、密钥、依赖和打包副本', opts, () => {
	const bad = files.filter(f => {
		const base = path.posix.basename(f);
		return /\.(log|bak|orig|tmp|swp|zip|rar|7z|pem|p12|pfx|key)$/i.test(base)
			|| base === 'project.private.config.json'
			|| (/^\.env(\..+)?$/.test(base) && base !== '.env.example')
			|| /(^|\/)node_modules\//.test(f)
			|| /^cloudfunctions\/(ordersWorker|notificationsWorker|tenantMigrator)\//.test(f);
	});
	assert.deepEqual(bad, []);
});

test('单个文件不超过 1 MB', opts, () => {
	const bad = files.filter(f => fs.statSync(path.join(root, f)).size > MAX_BYTES);
	assert.deepEqual(bad, [], '大文件请放云存储，不要提交到仓库');
});

test('说明文档只放在 docs/、.github/ 和根目录', opts, () => {
	const bad = files.filter(f => f.toLowerCase().endsWith('.md')
		&& !ROOT_FILES.has(f) && !/^docs\/[^/]+\.md$/.test(f) && !/^\.github\/[^/]+\.md$/.test(f));
	assert.deepEqual(bad, [], '模块说明请写进 docs/ 对应文档，过程记录写在提交说明里');
});

test('docs/ 下每份文档都在 README 的「维护文档」表中登记', opts, () => {
	const readme = read('README.md');
	const bad = docs().filter(f => !readme.includes('](' + f + ')'));
	assert.deepEqual(bad, []);
});

test('文档只描述现状，不含带日期的过程段落和过程用语', opts, () => {
	const bad = [];
	for (const f of ['README.md', ...docs()]) read(f).split(/\r?\n/).forEach((line, i) => {
		if (/\b20\d{2}-\d{2}-\d{2}\b/.test(line) || PROCESS_WORDS.some(w => line.includes(w))) bad.push(`${f}:${i + 1}`);
	});
	assert.deepEqual(bad, [], '把结论改写进正文，过程写进提交说明，见 CONTRIBUTING.md 第三节');
});

test('文档里的相对链接都指向存在的文件', opts, () => {
	const bad = [];
	for (const f of files.filter(f => f.toLowerCase().endsWith('.md'))) {
		for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
			const target = decodeURI(m[1].split('#')[0]);
			if (!target || /^[a-z]+:/i.test(target)) continue;
			if (!fs.existsSync(path.resolve(root, path.posix.dirname(f), target))) bad.push(`${f} → ${m[1]}`);
		}
	}
	assert.deepEqual(bad, []);
});
