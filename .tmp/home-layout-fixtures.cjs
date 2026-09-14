'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const base = 'projects/crun/pages/mail/add/mail_add_embedded';
const source = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/add/mail_add_logic.js'), 'utf8');
const context = { module: { exports: {} }, require: () => ({}) };
vm.runInNewContext(source, context);
const initial = context.module.exports.data;
const publish = require('../scripts/test-support/mail-ui-fixtures.cjs').scenarios().find(item => item.name === 'publish-open').data;
const values = { address1: '一期 · 菜鸟驿站', address2: '二期3号宿舍楼201室', poster: '林同学', tel: '13800000000', tel2: 'xiaolin_2026' };
const scenarios = () => [
  { id: 'empty', title: '首页 · 未填写', base, expected: '从哪里取，送到哪里', patch: {} },
  { id: 'filled', title: '首页 · 已填写', base, expected: '从哪里取，送到哪里', patch: { mailValues: { ...values } } },
  { id: 'long', title: '首页 · 长地址与联系人', base, expected: '从哪里取，送到哪里', patch: { mailValues: { ...values, address1: '一期 · 菜鸟驿站（学生服务中心一楼，靠近食堂西侧入口最里面的取件窗口）', address2: '二期3号宿舍楼201室，请从东侧楼梯上楼，到楼下后先电话联系，放在门口的置物架上即可。', poster: '林同学（到楼下后请先电话联系）' } } },
  { id: 'paused', title: '首页 · 暂停接单', base, expected: '暂时停止接单', patch: { serviceState: { kind: 'paused', title: '暂时停止接单', description: '校区暂时停止接单', canPublish: false }, mailValues: { ...values } } }
];
module.exports = {
  scenarios,
  pageState: fixture => ({ ...JSON.parse(JSON.stringify(initial)), ...publish, embedded: true, packageItems: [{ index: 0, label: '小件', price: '1.50', referencePrice: '1.50', code: '', note: '', images: [] }], ...fixture.patch }),
  previewTitle: '首页排版预览',
  previewSummary: '地址与联系人按手机宽度显示，长内容自动换行。'
};
