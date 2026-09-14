'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const builder = path.resolve(__dirname, '../scripts/build-admin-layout-preview.cjs');
let source = fs.readFileSync(builder, 'utf8');
// The order cards are slot content: retain the compiled page's children.
source = source.replace('if (child) {', 'if (child && !(node.children || []).length) {');
source = source.replace('wx-view,wx-page,wx-scroll-view,wx-form,wx-component,wx-picker{display:block}', 'wx-cmpt-comm-list,wx-view,wx-page,wx-scroll-view,wx-form,wx-component,wx-picker{display:block}');
const preview = new Module(builder, module);
preview.filename = builder;
preview.paths = Module._nodeModulePaths(path.dirname(builder));
preview._compile(source, builder);
