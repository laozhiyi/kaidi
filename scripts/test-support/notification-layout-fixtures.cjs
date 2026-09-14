'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mini = path.resolve(__dirname, '../../miniprogram');
const definitions = new Map();
function pageState(fixture) {
  const base = fixture.base || 'projects/crun/pages/' + fixture.page;
  if (!definitions.has(base)) {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(mini, base + '.js'), 'utf8'), {
      Page: value => { definition = value; }, Component: value => { definition = value; }, require: () => ({})
    });
    definitions.set(base, definition.data || {});
  }
  return { ...definitions.get(base), skin: {}, ...fixture.data };
}
function scenarios() {
  const news = { _id: 'news', key: 'news:news', kind: 'news', newsId: 'news', title: '今日雁山校区快递代取时间调整，请同学们提前安排取件',
    content: '今日服务延长至 22:00，取件前请留意驿站开放时间。', read: false, important: true };
  const list = [
    { ...news, time: '2026-09-14 10:30', category: '校园公告' },
    { _id: 'order', key: 'notification:order', kind: 'notification', title: '你的快递已送达', content: '接单人已上传送达凭证，请核对包裹后确认收货。', read: false, orderId: 'order', time: '2026-09-14 10:25', category: '订单动态' },
    { _id: 'feedback', key: 'notification:feedback', kind: 'notification', title: '申诉有新的处理结果', content: '管理员已回复，请点击查看完整处理说明。', read: false, feedbackId: 'feedback', time: '2026-09-14 09:10', category: '申诉处理' },
    { _id: 'read', key: 'notification:read', kind: 'notification', title: '订单已接取', content: '接单人正在前往驿站。', read: true, orderId: 'order', time: '2026-09-13 16:20', category: '订单动态' }
  ];
  const tab = (selected, count) => [{ base: 'custom-tab-bar/index', data: { selected, unreadCount: count } }];
  const cases = [
    { id: 'home-news', title: '首页 · 最新公告与未读角标', page: 'default/index/default_index', data: { featuredNews: news, noticeLoaded: true, unreadCount: 3, messageBadge: '3' }, extras: tab(0, 3), expected: news.title },
    { id: 'home-many', title: '首页 · 超过 99 条未读', page: 'default/index/default_index', data: { featuredNews: news, noticeLoaded: true, unreadCount: 108, messageBadge: '99+' }, extras: tab(0, 108), expected: '99+' },
    { id: 'home-empty', title: '首页 · 暂无公告', page: 'default/index/default_index', data: { noticeLoaded: true }, extras: tab(0, 0), expected: '暂无公告' },
    { id: 'my-messages', title: '我的 · 消息入口', page: 'my/index/my_index', data: { user: { USER_NAME: '校园同学', USER_STATUS: 1 }, unreadCount: 108, messageBadge: '99+' }, extras: tab(2, 108), expected: '99+' },
    { id: 'messages', title: '消息中心 · 公告与业务消息', page: 'operations/operations', data: { list, unreadCount: 3, summaryLoaded: true, config: { templateId: 'orders' } }, expected: '全部已读' },
    { id: 'unread', title: '消息中心 · 只看未读', page: 'operations/operations', data: { list: list.slice(0, 3), unreadOnly: true, unreadCount: 3, summaryLoaded: true }, expected: '✓ 只看未读' },
    { id: 'updates', title: '消息中心 · 有新的消息', page: 'operations/operations', data: { list, unreadCount: 4, summaryLoaded: true, hasUpdates: true }, expected: '消息有更新，点击刷新' },
    { id: 'empty-unread', title: '消息中心 · 已全部阅读', page: 'operations/operations', data: { unreadOnly: true, summaryLoaded: true }, expected: '暂无未读消息' },
    { id: 'sync-error', title: '消息中心 · 网络暂不可用', page: 'operations/operations', data: { list: list.slice(0, 1), unreadCount: 3, summaryLoaded: true, summaryError: true }, expected: '未读数量暂未同步' },
    { id: 'news-list', title: '公告列表 · 已读与未读', page: 'news/index/news_index', data: { isLoad: true, isLoggedIn: true, dataList: { list: [{ id: 'news', title: news.title, desc: news.content, ext: '2026-09-14', read: false, important: true }, { id: 'old', title: '校园快递代取服务说明', desc: '如何发布需求与联系接单人。', ext: '2026-09-10', read: true }], total: 2, page: 1, size: 20, count: 1 } }, expected: '● 未读' },
    { id: 'news-error', title: '公告详情 · 失败重试', page: 'news/detail/news_detail', data: { error: true }, expected: '重新加载' }
  ];
  return cases.map(fixture => ({ ...fixture, base: 'projects/crun/pages/' + fixture.page }));
}
module.exports = { scenarios, pageState, previewTitle: '公告与消息提醒 · 页面检查', previewSummary: '无页面横向溢出。' };
