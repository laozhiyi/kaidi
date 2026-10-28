'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Filter = require('../../miniprogram/projects/crun/biz/order_filter_biz.js');

const config = { locations: {
  phases: ['一期', '静园', '图书馆'],
  pickupStations: [{ name: '雅园', list: ['中通', '圆通'] }, { name: '知园', list: ['邮政'] }]
} };

test('delivery options are the same place groups used when saving an address', () => {
  const sources = Filter.buildSources(config);
  assert.deepEqual(sources.deliver.map(group => group.title), ['宿舍区', '校内地点']);
  // 宿舍区按期数选，格子下面带小区名，和「添加地址」的所在地点面板一致。
  assert.deepEqual(sources.deliver[0].items.map(item => item.label), ['一期', '二期', '三期', '四期', '五期']);
  assert.deepEqual(sources.deliver[0].items.map(item => item.name), ['怡园', '雅园', '容园', '恬园', '知园']);
  // 校内地点按地图图例顺序，宿舍区名不在这一组里重复出现。
  assert.deepEqual(sources.deliver[1].items.map(item => item.label), ['静园', '图书馆']);
  // 取件点照搬「选择常用快递点」：快递点是一个分组，分组里才是这家点能收的快递。
  assert.deepEqual(sources.pickup.map(group => group.title), ['雅园', '知园']);
  assert.deepEqual(sources.pickup[0].items, [
    { label: '中通', value: '雅园 · 中通' },
    { label: '圆通', value: '雅园 · 圆通' }
  ]);
  assert.deepEqual(sources.pickup[1].items.map(item => item.value), ['知园 · 邮政']);
});

test('an empty configuration still falls back to the built-in place table', () => {
  const sources = Filter.buildSources(null);
  assert.equal(sources.deliver[0].title, '宿舍区');
  assert.ok(sources.deliver.some(group => group.key === 'campus' && group.items.length > 10));
  assert.equal(sources.pickup.length, 0);
});

test('conditions stack across dimensions while several picks in one dimension stay a union', () => {
  const filter = { price: true, urgent: true, deliver: ['二期', '图书馆'], deliverOther: true, pickup: ['雅园 · 中通'] };
  const params = Filter.buildParams({ sortType: 'wait' }, filter);
  assert.equal(params.sortType, 'wait');
  assert.deepEqual(params.orderBy, { 'MAIL_OBJ.price': 'desc' });
  assert.equal(params.whereEx['MAIL_OBJ.urgent'], true);
  // 期数在订单里可能记成小区名，两种写法一起匹配。
  assert.deepEqual(params.whereEx['MAIL_OBJ.addressPhase'], ['in', ['二期', '雅园', '图书馆']]);
  assert.equal(params.whereEx['MAIL_OBJ.addressPhaseEmpty'], true);
  // 取件点成对提交：快递点在订单里也可能记成小区名，同样两种写法都带上。
  assert.deepEqual(params.whereEx['MAIL_OBJ.pickupPoint'], ['like', ['雅园 · 中通', '二期 · 中通']]);
  assert.equal(Filter.count(filter), 6);
  assert.equal(Filter.deliverSummary(filter), '3项');
});

test('a courier is always bound to the station it actually belongs to', () => {
  const sources = Filter.buildSources(config);
  // 每个快递公司都挂在它所属的快递点下面，不可能出现「快递点 + 任意快递公司」的组合。
  sources.pickup.forEach(group => group.items.forEach(item => assert.ok(item.value.startsWith(group.title + ' · '), item.value)));
  // 同一个快递公司在两个快递点是两条互不相干的条件。
  const params = Filter.buildParams({}, { pickup: ['雅园 · 中通', '知园 · 邮政'] });
  assert.deepEqual(params.whereEx['MAIL_OBJ.pickupPoint'], ['like', ['雅园 · 中通', '二期 · 中通', '知园 · 邮政', '五期 · 邮政']]);
});

test('「其他」only means orders published without a chosen place', () => {
  const onlyOther = Filter.buildParams({}, { deliver: [], deliverOther: true });
  assert.deepEqual(onlyOther.whereEx, { 'MAIL_OBJ.addressPhaseEmpty': true });
  assert.equal(Filter.deliverSummary({ deliver: [], deliverOther: true }), '其他');

  const onlyPlace = Filter.buildParams({}, { deliver: ['图书馆'] });
  assert.deepEqual(onlyPlace.whereEx, { 'MAIL_OBJ.addressPhase': ['in', ['图书馆']] });
  assert.equal(Filter.deliverSummary({ deliver: ['图书馆'] }), '图书馆');

  // 只留一个地点时不再写 addressPhaseEmpty，避免把「其他」也算进去。
  assert.equal(Filter.deliverSummary({ deliver: ['静园', '图书馆'] }), '2项');
});

test('clearing the filter keeps only the tab query and never leaves stale conditions behind', () => {
  const params = Filter.buildParams({
    sortType: 'my_post',
    orderBy: { 'MAIL_OBJ.price': 'desc' },
    whereEx: { 'MAIL_OBJ.urgent': true }
  }, Filter.emptyFilter());
  assert.deepEqual(params, { sortType: 'my_post' });
  assert.equal(Filter.count(Filter.emptyFilter()), 0);
  assert.equal(Filter.deliverSummary(Filter.emptyFilter()), '');
  assert.equal(Filter.summaryText([]), '');
});

test('places are trimmed, capped, and de-duplicated before they reach the server', () => {
  assert.equal(Filter.cleanKeyword('  静园   3栋 \n201 '), '静园 3栋 201');
  const many = Array.from({ length: 15 }, (_, index) => '地点' + index);
  const params = Filter.buildParams({}, { deliver: many });
  assert.equal(params.whereEx['MAIL_OBJ.addressPhase'][1].length, Filter.MAX_PLACES);
  const repeated = Filter.buildParams({}, { deliver: ['静园', '静园', ' 静园 '] });
  assert.deepEqual(repeated.whereEx['MAIL_OBJ.addressPhase'], ['in', ['静园']]);
});
