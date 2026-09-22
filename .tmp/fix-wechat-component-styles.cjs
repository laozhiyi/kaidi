'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
function edit(file, change) {
  const before = fs.readFileSync(file, 'utf8');
  const after = change(before);
  assert.notEqual(after, before, 'No style edit: ' + file);
  fs.writeFileSync(file, after);
  console.log(file);
}
function classes(source, names, disabledClass) {
  return source.replace(/<(?:view|text|input|textarea|button|image|switch|picker|root-portal)\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>/g, tag => {
    const name = /^<([\w-]+)/.exec(tag)[1];
    if (!names[name]) return tag;
    let extra = names[name];
    const disabled = /\sdisabled="\{\{([\s\S]*?)\}\}"/.exec(tag);
    if (disabled && disabledClass && name === 'button') extra += " {{(" + disabled[1] + ") ? '" + disabledClass + "' : ''}}";
    if (/\sclass="/.test(tag)) return tag.replace(/(\sclass=")([^"]*)"/, (_, start, existing) => start + existing + ' ' + extra + '"');
    return tag.replace(/^<([\w-]+)/, '<$1 class="' + extra + '"');
  });
}
function selectors(source, names, disabledClass) {
  return source.replace(/([^{}]+)\{/g, (_, head) => {
    head = head.replace(/(^|[\s>+~,])(page|view|text|input|textarea|button|image|switch|picker|root-portal)(?=$|[\s:.#\[>+~,])/g,
      (match, before, name) => names[name] ? before + '.' + names[name] : match);
    if (disabledClass) head = head.replaceAll('[disabled]', '.' + disabledClass);
    return head + '{';
  });
}
const publish = 'miniprogram/projects/crun/pages/mail/add/';
const pubClasses = { page: 'publish-page', view: 'pub-view', text: 'pub-text', input: 'pub-input', textarea: 'pub-textarea', button: 'pub-button-base', image: 'pub-image', switch: 'pub-switch' };
for (const file of ['mail_add.wxml', 'business_order_fields.wxml', 'mail_profile_picker.wxml', 'mail_package_pickup.wxml']) {
  edit(publish + file, text => classes(text, pubClasses, 'pub-disabled'));
}
edit(publish + 'mail_add.wxss', text => selectors(text, pubClasses, 'pub-disabled'));
edit(publish + 'mail_add_embedded.wxss', text => selectors(text, pubClasses).replace('min-height: 0;', 'min-height: 0;\n\tbackground: transparent;'));

const deadline = 'miniprogram/projects/crun/cmpts/deadline_picker/deadline_picker';
edit(deadline + '.wxml', text => classes(text, { button: 'deadline-button', text: 'deadline-text' }, 'deadline-button-disabled'));
edit(deadline + '.wxss', text => selectors(text, { button: 'deadline-button', text: 'deadline-text' }, 'deadline-button-disabled'));
const campus = 'miniprogram/projects/crun/cmpts/campus_selector/campus_selector';
edit(campus + '.wxml', text => classes(text, { picker: 'campus-picker', text: 'campus-text' }));
edit(campus + '.wxss', text => selectors(text, { picker: 'campus-picker', text: 'campus-text' }));
const rows = 'miniprogram/cmpts/public/rows/rows_cmpt';
edit(rows + '.wxml', text => classes(text, { image: 'rows-image', input: 'rows-input', textarea: 'rows-textarea' }));
edit(rows + '.wxss', text => selectors(text, { image: 'rows-image', input: 'rows-input', textarea: 'rows-textarea' }));
const car = 'miniprogram/cmpts/public/car_number/car_number_cmpt';
edit(car + '.wxml', text => classes(text, { 'root-portal': 'car-portal', text: 'car-label' }));
edit(car + '.wxss', text => selectors(text, { 'root-portal': 'car-portal', text: 'car-label' }));

// This component already opts into global classes; app.wxss imports these sheets.
edit('miniprogram/cmpts/public/img/img_upload_cmpt.wxss', text => text.replace(/^@import[^\n]+\r?\n/gm, ''));
edit('miniprogram/style/base/icon.wxss', text => {
  const icons = [...new Set([...text.matchAll(/\.(icon-[\w-]+):before\s*\{/g)].map(match => '.' + match[1]))];
  assert.ok(icons.length > 100, 'Expected the existing icon catalogue');
  const selector = '[class*="icon-"]';
  assert.ok(text.includes(selector));
  return text.replace(selector, '/* Explicit classes also work inside isolated WeChat components. */\n' + icons.join(',\n'));
});
