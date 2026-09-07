const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');

// 两端共用消息窗口，端点及身份检查由页面传入。
module.exports = function createChatPage(config) {
	return {
		data: {
			chatId: '', service: null, userId: '', messages: [], content: '',
			isLoad: false, isSending: false, loading: false, loadingEarlier: false,
			hasMore: false, nextBefore: '', errorText: '', historyError: '',
			scrollIntoView: '', scrollTop: 0, hasNewMessages: false,
			ownSender: config.ownSender, isAdminChat: config.ownSender === 'admin'
		},
		onLoad: function (options) {
			this._epoch = 0;
			this._draftVersion = 0;
			this._nearBottom = true;
			if (!config.init(this)) return;
			if (!options || !options[config.idKey]) {
				this.setData({ isLoad: true, errorText: '参数错误，请返回重新选择会话' });
				return;
			}
			this.setData({ chatId: options[config.idKey] });
		},
		onShow: function () {
			this._visible = true;
			if (this.data.chatId) this._loadMessages();
		},
		onHide: function () {
			this._visible = false;
			this._epoch++;
			this._request = null;
			clearTimeout(this._pollTimer);
			this.setData({ loading: false, loadingEarlier: false });
		},
		onUnload: function () {
			this._destroyed = true;
			this._visible = false;
			this._epoch++;
			clearTimeout(this._pollTimer);
		},
		onPullDownRefresh: async function () {
			try { await this._loadMessages(); } finally { wx.stopPullDownRefresh(); }
		},
		_schedulePoll: function () {
			clearTimeout(this._pollTimer);
			if (!this._visible || !this.data.chatId || this._destroyed) return;
			this._pollTimer = setTimeout(() => {
				if (this.data.isSending) this._schedulePoll();
				else this._loadMessages({ quiet: true });
			}, 6000);
		},
		_fetch: async function (before) {
			const params = { [config.idKey]: this.data.chatId, limit: 50 };
			if (before) params.before = before;
			// callCloudData 会吞掉异常；这里保留网络错误与不存在记录的区别。
			const response = await cloudHelper.callCloud(config.getRoute, params, { hint: false });
			if (!response || response.code !== 200) throw new Error('消息加载失败');
			return response.data;
		},
		_loadMessages: function (options = {}) {
			if (!this._visible || !this.data.chatId) return Promise.resolve();
			if (this._request) return this._request;
			if (options.older && (!this.data.hasMore || !this.data.nextBefore)) return Promise.resolve();
			clearTimeout(this._pollTimer);
			const epoch = this._epoch;
			this.setData(options.older ? { loadingEarlier: true, historyError: '' } : { loading: !options.quiet });
			const request = this._performLoad(options, epoch).finally(() => {
				if (epoch !== this._epoch || this._destroyed) return;
				this._request = null;
				this.setData({ loading: false, loadingEarlier: false });
				this._schedulePoll();
			});
			this._request = request;
			return request;
		},
		_performLoad: async function (options, epoch) {
			try {
				const previous = this.data.messages;
				const result = await this._fetch(options.older ? this.data.nextBefore : '');
				if (epoch !== this._epoch || !this._visible) return;
				if (!result || !result.service) {
					this.setData({ service: null, isLoad: true, errorText: '会话不存在或客服已停用，请返回重新选择' });
					return;
				}
				if (!Array.isArray(result.messages)) throw new Error('消息格式错误');
				let incoming = result.messages;
				const known = new Set(previous.map(item => item.CSM_ID));
				// 离开页面期间若新增超过一页，向前补齐窗口，避免中间漏消息。
				let page = result;
				const cursors = new Set();
				while (!options.older && previous.length && incoming.length &&
					!incoming.some(item => known.has(item.CSM_ID)) && page.hasMore && page.nextBefore) {
					if (cursors.has(page.nextBefore)) throw new Error('消息分页游标异常');
					cursors.add(page.nextBefore);
					page = await this._fetch(page.nextBefore);
					if (epoch !== this._epoch || !this._visible) return;
					if (!page || !Array.isArray(page.messages)) throw new Error('消息加载失败');
					incoming = page.messages.concat(incoming);
				}
				const incomingIds = new Set(incoming.map(item => item.CSM_ID));
				const retained = previous.filter(item => !incomingIds.has(item.CSM_ID));
				const byId = new Map();
				(options.older ? incoming.concat(retained) : retained.concat(incoming)).forEach(item => byId.set(item.CSM_ID, item));
				const messages = Array.from(byId.values());
				const changed = JSON.stringify(messages) !== JSON.stringify(previous);
				const hasAdded = incoming.some(item => !known.has(item.CSM_ID));
				const initial = !this.data.isLoad || !this.data.service;
				const position = options.older ? await this._measureMessages() : null;
				if (epoch !== this._epoch || !this._visible) return;
				const patch = { service: result.service, userId: result.userId || '', isLoad: true, errorText: '', historyError: '' };
				if (changed) patch.messages = messages;
				if (options.older) patch.scrollIntoView = '';
				if (initial || options.older || !previous.length) {
					patch.hasMore = !!result.hasMore && !!result.nextBefore;
					patch.nextBefore = result.nextBefore || '';
				}
				if (!options.older && hasAdded && !this._nearBottom && !initial) patch.hasNewMessages = true;
				await new Promise(resolve => this.setData(patch, resolve));
				if (epoch !== this._epoch || !this._visible) return;
				if (options.older && changed && position) {
					const after = await this._measureMessages();
					if (epoch === this._epoch && this._visible && after) {
						this.setData({ scrollIntoView: '', scrollTop: position.top + after.height - position.height });
					}
				} else if (!options.older && (initial || (hasAdded && this._nearBottom))) this._scrollBottom();
			} catch (err) {
				if (epoch !== this._epoch || !this._visible) return;
				if (options.older) this.setData({ historyError: '更早消息加载失败，点击重试' });
				else this.setData({ isLoad: true, errorText: '消息刷新失败，已保留当前对话，请重试' });
			}
		},
		_measureMessages: function () {
			return new Promise(resolve => {
				const query = this.createSelectorQuery();
				query.select('.message-content').boundingClientRect();
				query.select('.message-list').scrollOffset();
				query.exec(result => resolve(result && result[0] && result[1] ? { height: result[0].height, top: result[1].scrollTop } : null));
			});
		},
		bindEarlierTap: function () { return this._loadMessages({ older: true }); },
		bindRefreshTap: function () { return this._loadMessages(); },
		bindMessageScroll: function (e) {
			this._scrollHeight = e.detail.scrollHeight;
			this._scrollTop = e.detail.scrollTop;
			if (!this._viewportHeight) {
				this.createSelectorQuery().select('.message-list').boundingClientRect(rect => {
					if (rect) this._viewportHeight = rect.height;
				}).exec();
			}
			this._nearBottom = !!this._viewportHeight && e.detail.scrollHeight - e.detail.scrollTop - this._viewportHeight < 80;
			if (!this._nearBottom && this.data.scrollIntoView) this.setData({ scrollIntoView: '' });
			if (this._nearBottom && this.data.hasNewMessages) this.setData({ hasNewMessages: false });
		},
		bindScrollLower: function () {
			this._nearBottom = true;
			this.setData({ hasNewMessages: false });
		},
		_scrollBottom: function () {
			if (!this._visible || !this.data.messages.length) return;
			this._nearBottom = true;
			this.setData({ scrollIntoView: '', hasNewMessages: false }, () => {
				if (this._visible && !this._destroyed) this.setData({ scrollIntoView: 'messages-bottom' });
			});
		},
		bindLatestTap: function () { this._scrollBottom(); },
		bindContentInput: function (e) {
			this._draftVersion++;
			this.setData({ content: e.detail.value });
		},
		bindSendTap: async function () {
			if (this.data.isSending || !this.data.service || !this._visible) return;
			if (this.data.service.CS_STATUS !== 1) return pageHelper.showModal('该客服已停用，暂时无法发送', '温馨提示');
			const content = String(this.data.content || '').trim();
			if (!content) return pageHelper.showModal('请输入消息内容', '温馨提示');
			if (content.length > 500) return pageHelper.showModal('消息不能超过500字', '温馨提示');
			const draftVersion = this._draftVersion;
			this.setData({ isSending: true });
			clearTimeout(this._pollTimer);
			try {
				await cloudHelper.callCloudSumbit(config.sendRoute, { [config.idKey]: this.data.chatId, content }, { hint: false });
				if (this._destroyed) return;
				if (draftVersion === this._draftVersion) this.setData({ content: '' });
				// 等待旧刷新完成，再读取发送后的窗口，避免旧响应覆盖新消息。
				if (this._request) await this._request;
				if (this._visible) await this._loadMessages({ quiet: true });
			} catch (err) {
				if (this._visible && !this._destroyed) pageHelper.showModal((err && (err.msg || err.message)) || '发送失败，内容已保留，请重试', '温馨提示');
			} finally {
				if (!this._destroyed) this.setData({ isSending: false });
				this._schedulePoll();
			}
		}
	};
};
