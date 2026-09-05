Component({
	externalClasses: [],

	options: {
		addGlobalClass: true,
	},

	properties: {
		label: {
			type: String,
			value: '',
		},
		// 选项：[{label, val}] 或简单字符串 ['A','B']
		options: {
			type: Array,
			value: [],
			observer: '_onOptionsChange',
		},
		// 当前选中的 val
		item: {
			type: String,
			value: '',
			observer: '_onItemChange',
		},
		unselectedHint: {
			type: String,
			value: '未选择',
		},
		disabled: {
			type: Boolean,
			value: false,
		},
	},

	data: {
		show: false,
		curIndex: -1,
		curLabel: '未选择',
	},

	lifetimes: {
		ready: function () {
			this._syncByItem(this.data.item);
		},
	},

	methods: {
		// options 变化时重新同步
		_onOptionsChange: function () {
			this._syncByItem(this.data.item);
		},

		// item 变化时重新同步
		_onItemChange: function (newVal) {
			this._syncByItem(newVal);
		},

		// 根据 val 找 index 和 label
		_syncByItem: function (val) {
			const opts = this.data.options;
			if (!opts || opts.length === 0) return;

			let idx = -1;
			let label = this.data.unselectedHint;

			for (let i = 0; i < opts.length; i++) {
				const opt = opts[i];
				// 支持 {label, val} 和纯字符串两种格式
				const optVal = typeof opt === 'object' && opt.val !== undefined ? opt.val : opt;
				const optLabel = typeof opt === 'object' && opt.label !== undefined ? opt.label : opt;
				if (optVal === val) {
					idx = i;
					label = optLabel;
					break;
				}
			}

			this.setData({ curIndex: idx, curLabel: label });
		},

		toggle: function () {
			if (this.data.disabled) return;
			this.setData({ show: !this.data.show });
		},

		close: function () {
			this.setData({ show: false });
		},

		bindSelect: function (e) {
			const index = parseInt(e.currentTarget.dataset.index);
			const opt = this.data.options[index];
			// 支持 {label, val} 和纯字符串两种格式
			const val = typeof opt === 'object' && opt.val !== undefined ? opt.val : opt;
			const label = typeof opt === 'object' && opt.label !== undefined ? opt.label : opt;

			this.setData({
				curIndex: index,
				curLabel: label,
				show: false,
			});
			this.triggerEvent('select', val);
		},
	},
});
