'use strict';
// Reproduce the regression against this task's baseline without changing the
// working tree or weakening validation in the route fixtures.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), baseline = path.join(__dirname, 'content-audit-before');
const read = fs.readFileSync;
const files = JSON.parse(read(path.join(baseline, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const overrides = new Map(files.filter(file => file.startsWith('cloudfunctions/')).map(file => [path.resolve(root, file).toLowerCase(), path.resolve(baseline, file)]));
fs.readFileSync = function (file, ...args) {
  const original = typeof file === 'string' && overrides.get(path.resolve(file).toLowerCase());
  return read.call(this, original || file, ...args);
};
