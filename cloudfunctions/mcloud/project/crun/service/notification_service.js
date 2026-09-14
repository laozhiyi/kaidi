'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');

const PAGE_SIZE = 20;
const NEWS_FIELDS = { _id: true, NEWS_TITLE: true, NEWS_DESC: true, NEWS_ADD_TIME: true, NEWS_EDIT_TIME: true, NEWS_ORDER: true };
const MESSAGE_FIELDS = { _id: true, title: true, content: true, createdAt: true, read: true, orderId: true, feedbackId: true, reputation: true };
const compare = (a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);

class NotificationService extends Base {
  _query(name, where) {
    return store.database().collection(store.collection(name)).where({ ...where, _pid: this.getProjectId() });
  }

  // Walk every page of small metadata records; the SDK's default limit must not truncate unread counts.
  async _scan(name, where, fields) {
    const rows = [], cmd = store.database().command;
    let after = '';
    for (;;) {
      const result = await this._query(name, { ...where, ...(after ? { _id: cmd.gt(after) } : {}) })
        .field(fields).orderBy('_id', 'asc').limit(100).get();
      rows.push(...result.data);
      if (result.data.length < 100) return rows;
      after = result.data[result.data.length - 1]._id;
    }
  }

  _news(row, read = null) {
    return { _id: row._id, key: 'news:' + row._id, kind: 'news', newsId: row._id,
      title: row.NEWS_TITLE || '校园公告', content: row.NEWS_DESC || '',
      createdAt: Number(row.NEWS_ADD_TIME) || 0, updatedAt: Number(row.NEWS_EDIT_TIME) || 0,
      important: row.NEWS_ORDER === 0, order: Number(row.NEWS_ORDER), read };
  }

  _message(row) {
    return { _id: row._id, key: 'notification:' + row._id, kind: 'notification',
      title: row.title || '系统通知', content: row.content || '', createdAt: Number(row.createdAt) || 0,
      read: row.read === true, orderId: row.orderId || '', feedbackId: row.feedbackId || '', reputation: row.reputation === true };
  }

  async featured() {
    const result = await this._query('news', { NEWS_STATUS: 1 }).field(NEWS_FIELDS)
      .orderBy('NEWS_ORDER', 'asc').orderBy('NEWS_ADD_TIME', 'desc').orderBy('_id', 'desc').limit(1).get();
    return { featuredNews: result.data.length ? this._news(result.data[0]) : null };
  }

  async readNewsIds(userId, ids) {
    if (!userId || ids && !ids.length) return new Set();
    const where = { userId };
    if (ids) where.newsId = store.database().command.in(ids);
    const rows = await this._scan('news_read', where, { _id: true, newsId: true });
    return new Set(rows.map(row => row.newsId));
  }

  async _newsFor(userId) {
    const [rows, readIds] = await Promise.all([
      this._scan('news', { NEWS_STATUS: 1 }, NEWS_FIELDS), this.readNewsIds(userId)
    ]);
    return rows.map(row => this._news(row, readIds.has(row._id)));
  }

  async summary(userId) {
    await new Mail()._user(userId);
    const cmd = store.database().command;
    const [news, unread, latest] = await Promise.all([
      this._newsFor(userId), this._query('notification', { userId, read: cmd.neq(true) }).count(),
      this._query('notification', { userId }).field(MESSAGE_FIELDS).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(1).get()
    ]);
    const ordered = news.slice().sort((a, b) => a.order - b.order || compare(a, b));
    const newsUnread = news.filter(row => !row.read).length;
    const featuredNews = ordered.find(row => row.important && !row.read) || ordered.find(row => !row.read) || ordered[0] || null;
    return { unreadCount: unread.total + newsUnread, newsUnread, personalUnread: unread.total, featuredNews,
      signature: store.key(news.map(row => [row._id, row.updatedAt, row.order, row.read]), unread.total,
        latest.data.map(row => [row._id, row.read, row.createdAt])) };
  }

  _cursor(value) {
    if (!value) return null;
    if (typeof value !== 'object' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 ||
      !['news', 'notification'].includes(value.kind) || typeof value.id !== 'string' || !/^[\w-]{1,128}$/.test(value.id)) {
      this.AppError('消息分页参数无效');
    }
    return { createdAt: value.createdAt, kind: value.kind, id: value.id, key: value.kind + ':' + value.id };
  }

  async list(userId, { page = 1, unreadOnly = false, cursor } = {}) {
    await new Mail()._user(userId);
    if (!Number.isInteger(page) || page < 1 || page > 500 || typeof unreadOnly !== 'boolean') this.AppError('消息分页参数无效');
    cursor = this._cursor(cursor);
    const db = store.database(), cmd = db.command;
    const where = { userId, ...(unreadOnly ? { read: cmd.neq(true) } : {}) };
    const [allNews, total] = await Promise.all([this._newsFor(userId), this._query('notification', where).count()]);
    const news = allNews.filter(row => !unreadOnly || !row.read);
    const eligibleNews = cursor ? news.filter(row => compare(row, cursor) > 0) : news;
    const conditions = [{ ...where, _pid: this.getProjectId() }];
    if (cursor) {
      // Personal messages precede announcements in descending key order at the same timestamp.
      conditions.push(cursor.kind === 'news' ? { createdAt: cmd.lt(cursor.createdAt) } : cmd.or([
        { createdAt: cmd.lt(cursor.createdAt) }, { createdAt: cursor.createdAt, _id: cmd.lt(cursor.id) }
      ]));
    }
    const personal = [], needed = (cursor ? PAGE_SIZE : page * PAGE_SIZE) + 1;
    for (let offset = 0; offset < needed; offset += 100) {
      const take = Math.min(100, needed - offset);
      const result = await db.collection(store.collection('notification')).where(cmd.and(conditions)).field(MESSAGE_FIELDS)
        .orderBy('createdAt', 'desc').orderBy('_id', 'desc').skip(offset).limit(take).get();
      personal.push(...result.data.map(row => this._message(row)));
      if (result.data.length < take) break;
    }
    // Personal messages precede announcements with the same timestamp. Keep those announcements after a personal cursor.
    const merged = personal.concat(eligibleNews).sort(compare);
    const start = cursor ? 0 : (page - 1) * PAGE_SIZE;
    const list = merged.slice(start, start + PAGE_SIZE), last = list[list.length - 1];
    return { list, page, size: PAGE_SIZE, total: total.total + news.length, hasMore: merged.length > start + PAGE_SIZE,
      nextCursor: last ? { createdAt: last.createdAt, kind: last.kind, id: last._id } : null };
  }

  async markRead(userId, id, kind = 'notification') {
    const mail = new Mail(), user = await mail._user(userId);
    if (!['news', 'notification'].includes(kind)) this.AppError('消息类型无效');
    return store.transaction(async tx => {
      await mail._actor(tx, { userId, user });
      const row = await store.get(tx, kind === 'news' ? 'news' : 'notification', id);
      if (!row || row._pid !== this.getProjectId() || (kind === 'news' ? row.NEWS_STATUS !== 1 : row.userId !== userId)) this.AppError('消息不存在或已撤下');
      if (kind === 'news') {
        const key = store.key(this.getProjectId(), userId, id);
        if (!await store.get(tx, 'news_read', key)) await store.set(tx, 'news_read', key, { _pid: this.getProjectId(), userId, newsId: id, readAt: Date.now() });
      } else if (row.read !== true) await store.set(tx, 'notification', id, { ...row, read: true, readAt: Date.now() });
      return { ok: true };
    });
  }

  async markAllRead(userId) {
    await new Mail()._user(userId);
    const cmd = store.database().command, pid = this.getProjectId();
    // Capture explicit IDs before writing: messages arriving during this action remain unread.
    const [news, messages] = await Promise.all([
      this._newsFor(userId), this._scan('notification', { userId, read: cmd.neq(true) }, { _id: true })
    ]);
    const unreadNews = news.filter(row => !row.read), readAt = Date.now();
    for (let i = 0; i < messages.length; i += 50) {
      await this._query('notification', { userId, _id: cmd.in(messages.slice(i, i + 50).map(row => row._id)) })
        .update({ data: { read: true, readAt } });
    }
    for (let i = 0; i < unreadNews.length; i += 20) {
      await Promise.all(unreadNews.slice(i, i + 20).map(row => store.set(store.database(), 'news_read', store.key(pid, userId, row._id),
        { _pid: pid, userId, newsId: row._id, readAt })));
    }
    return { ok: true };
  }
}
module.exports = NotificationService;
