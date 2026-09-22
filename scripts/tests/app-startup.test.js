'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch(wx) {
  let app;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/app.js'), 'utf8'), {
    wx: { cloud: { init() {} }, ...wx }, App: value => { app = value; }, require: () => ({})
  });
  app.onLaunch({}); return app;
}

test('app startup calculates navigation geometry using the current window API', () => {
  const capsule = { top: 48, bottom: 80 };
  const app = launch({ getWindowInfo: () => ({ statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => capsule,
    getSystemInfo() { throw Error('The deprecated API must not be used on current WeChat'); } });
  assert.equal(app.globalData.statusBarHeight, 44);
  assert.equal(app.globalData.customBarHeight, 84);
  assert.deepEqual(app.globalData.capsule, capsule);
});

test('app startup retains the older-client navigation fallback', () => {
  const app = launch({ getMenuButtonBoundingClientRect: () => null,
    getSystemInfo: options => options.success({ statusBarHeight: 20 }) });
  assert.equal(app.globalData.statusBarHeight, 20);
  assert.equal(app.globalData.customBarHeight, 70);
});
