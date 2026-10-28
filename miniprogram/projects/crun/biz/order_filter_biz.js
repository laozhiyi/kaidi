'use strict';
/**
 * 订单中心筛选。
 *
 * 送达地点用的就是下单／填写常用地址时那个「所在地点」面板（宿舍区 + 校内地点），
 * 选项与数据源完全一致，用户不需要重新理解一套地点。另一个「其他」不是让用户
 * 手打关键词，而是指下单时没选地点、按详细地址送达的订单（MAIL_OBJ.addressPhase 为空）。
 *
 * 取件地点复用下单时的「选择常用快递点」面板：快递点（二期／五期／奥林苑）之下才是
 * 实际到这个点的快递公司，选的是一对「快递点 · 快递公司」。快递公司与快递点是绑定的，
 * 不能拆成两个维度自由组合（否则会选出「二期 · 京东」这种不存在的取件点）。
 *
 * 组合规则：不同维度之间「且」（加急 + 价格 + 送达地点 + 取件地点），
 * 同一维度内多选「或」。
 */
const Address = require('./address_biz.js');

// 与服务端 mail/list 的 whereEx 上限保持一致，避免提交后被拒。
const MAX_PLACES = 10;
const MAX_KEYWORDS = 20;

function emptyFilter() {
	return { price: false, urgent: false, deliver: [], deliverOther: false, pickup: [] };
}

/** 地点名只保留可见字符，压掉换行与连续空格。 */
function cleanKeyword(value) {
	const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
	return Array.from(text).slice(0, 30).join('');
}

function shorten(text, max) {
	const chars = Array.from(String(text == null ? '' : text));
	return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

function uniqueStrings(list) {
	const seen = new Set();
	return (Array.isArray(list) ? list : []).map(cleanKeyword).filter(item => {
		if (!item || seen.has(item)) return false;
		seen.add(item);
		return true;
	});
}

/**
 * 取件地点：一个快递点一组，组内才是这家快递点的快递公司。
 * 选中的值就是下单时写入 MAIL_OBJ.address1 的「快递点 · 快递公司」。
 */
function pickupGroups(pickupStations) {
	const groups = [];
	(Array.isArray(pickupStations) ? pickupStations : []).forEach((station, index) => {
		const name = cleanKeyword(station && station.name);
		if (!name) return;
		const items = uniqueStrings(station && station.list).slice(0, 12).map(courier => ({
			label: shorten(courier, 16),
			// 与下单时写入 MAIL_OBJ.address1 的格式一致；服务端单条关键词上限 30 字。
			value: Array.from(name + ' · ' + courier).slice(0, 30).join('')
		}));
		if (items.length) groups.push({ key: 'station-' + index, title: shorten(name, 16), hint: '', items });
	});
	return groups;
}

/**
 * 生成两个筛选维度的候选分组。
 * config 为 operations/config 的返回；送达地点复用「添加地址」页的同一份地点表。
 */
function buildSources(config) {
	const locations = config && config.locations || {};
	try { Address.configure(locations); } catch (_) { /* 配置异常时沿用默认地点表 */ }
	let groups = [];
	try { groups = Address.placeGroups(); } catch (_) { groups = []; }
	return {
		deliver: (Array.isArray(groups) ? groups : []).map(group => ({
			key: group.key,
			title: group.title,
			hint: group.hint || '',
			items: (group.items || []).map(item => ({ label: item.label, value: item.label, name: item.name || '' }))
		})).filter(group => group.items.length),
		pickup: pickupGroups(locations.pickupStations)
	};
}

/**
 * 宿舍区在订单里可能记成期数（二期）也可能记成小区名（雅园），
 * 两种写法都匹配，避免旧订单筛不出来。
 */
function phaseKeywords(list) {
	const alias = new Map((Address.DORM_PHASES || []).map(item => [item.label, item.name]));
	const out = [];
	uniqueStrings(list).slice(0, MAX_PLACES).forEach(label => {
		out.push(label);
		const name = alias.get(label);
		if (name) out.push(name);
	});
	return [...new Set(out)];
}

/**
 * 取件点写的是「快递点 · 快递公司」。快递点同样存在两种写法（二期／雅园），
 * 选中一对时把两种写法都带上，老订单也能筛出来。
 */
function pickupKeywords(list) {
	const alias = new Map();
	(Address.DORM_PHASES || []).forEach(item => {
		alias.set(item.label, item.name);
		alias.set(item.name, item.label);
	});
	const out = [];
	uniqueStrings(list).slice(0, MAX_PLACES).forEach(pair => {
		out.push(pair);
		const gap = pair.indexOf(' · ');
		if (gap <= 0) return;
		const other = alias.get(pair.slice(0, gap));
		if (other) out.push(other + pair.slice(gap));
	});
	return [...new Set(out)].slice(0, MAX_KEYWORDS);
}

/**
 * 把筛选状态合并进 mail/list 参数。
 * base 为各 Tab 的原始参数，只保留 sortType 等固有字段，避免筛选被反复叠加。
 */
function buildParams(base, filter) {
	const params = Object.assign({}, base || {});
	delete params.orderBy;
	delete params.whereEx;
	const next = Object.assign(emptyFilter(), filter || {});
	if (next.price) params.orderBy = { 'MAIL_OBJ.price': 'desc' };
	const whereEx = {};
	if (next.urgent) whereEx['MAIL_OBJ.urgent'] = true;
	const places = phaseKeywords(next.deliver);
	if (places.length) whereEx['MAIL_OBJ.addressPhase'] = ['in', places];
	if (next.deliverOther) whereEx['MAIL_OBJ.addressPhaseEmpty'] = true;
	const pickup = pickupKeywords(next.pickup);
	if (pickup.length) whereEx['MAIL_OBJ.pickupPoint'] = ['like', pickup];
	if (Object.keys(whereEx).length) params.whereEx = whereEx;
	return params;
}

/** 已启用的条件数量，用来控制「全部」的高亮。 */
function count(filter) {
	const next = Object.assign(emptyFilter(), filter || {});
	return (next.price ? 1 : 0) + (next.urgent ? 1 : 0)
		+ uniqueStrings(next.deliver).length + (next.deliverOther ? 1 : 0) + uniqueStrings(next.pickup).length;
}

/** 筛选条上的送达地点摘要：单个地点显示名字，多项显示数量。 */
function deliverSummary(filter) {
	const next = Object.assign(emptyFilter(), filter || {});
	const places = uniqueStrings(next.deliver);
	const total = places.length + (next.deliverOther ? 1 : 0);
	if (!total) return '';
	if (total === 1) return places.length ? shorten(places[0], 10) : '其他';
	return total + '项';
}

function summaryText(list) {
	const picked = uniqueStrings(list);
	if (!picked.length) return '';
	return picked.length === 1 ? shorten(picked[0], 10) : picked.length + '项';
}

module.exports = {
	MAX_PLACES,
	MAX_KEYWORDS,
	emptyFilter,
	cleanKeyword,
	buildSources,
	buildParams,
	count,
	deliverSummary,
	summaryText
};
