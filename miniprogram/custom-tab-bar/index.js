Component({
	data: {
		selected: 0,
		list: [
			{ pagePath: '/projects/crun/pages/default/index/default_index', text: '首页', icon: 'icon-home', selectedIcon: 'icon-homefill' },
			{ pagePath: '/projects/crun/pages/order/index/order_index', text: '订单', icon: 'icon-order', selectedIcon: 'icon-order' },
			{ pagePath: '/projects/crun/pages/my/index/my_index', text: '我的', icon: 'icon-my', selectedIcon: 'icon-myfill' }
		]
	},
	lifetimes: {
		ready() {
			this.syncSelected();
		}
	},
	pageLifetimes: {
		show() {
			this.syncSelected();
		}
	},
	methods: {
		syncSelected() {
			const pages = getCurrentPages();
			const page = pages[pages.length - 1];
			if (!page) return;
			const selected = this.data.list.findIndex(item => item.pagePath === '/' + page.route);
			if (selected >= 0) this.setData({ selected });
		},
		switchTab(e) {
			const index = Number(e.currentTarget.dataset.index);
			const item = this.data.list[index];
			if (!item || index === this.data.selected) return;
			wx.switchTab({
				url: item.pagePath,
				fail: () => {
					wx.showToast({ title: '切换失败，请重试', icon: 'none' });
				}
			});
		}
	}
});
