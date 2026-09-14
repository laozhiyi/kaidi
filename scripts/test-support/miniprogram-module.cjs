'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load shared page definitions with the same platform mocks as their entry point.
function runMiniProgram(file, globals = {}) {
 const module = globals.module || { exports: {} };
 const stub = globals.require || (() => ({}));
 vm.runInNewContext(fs.readFileSync(file, 'utf8'), { ...globals, module, require(name) {
  if (name === './mail_add_logic.js') {
   const nested = { ...globals }; delete nested.module;
   return runMiniProgram(path.resolve(path.dirname(file), name), nested);
  }
  return stub(name);
 } }, { filename: file });
 return module.exports;
}
module.exports = { runMiniProgram };
