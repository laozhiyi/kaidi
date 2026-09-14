const UI = require('../../biz/admin_console_biz.js');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { active: { type: String, value: 'home' } },
  data: { items: [
    { key: 'home', label: '工作台', icon: 'icon-home' },
    { key: 'orders', label: '订单', icon: 'icon-form' },
    { key: 'feedback', label: '投诉', icon: 'icon-message' },
    { key: 'users', label: '用户', icon: 'icon-group' },
    { key: 'settings', label: '管理', icon: 'icon-settings' }
  ] },
  methods: {
    bindNavigate(e) {
      const key = e.currentTarget.dataset.key;
      if (key !== this.data.active && this.data.items.some(item => item.key === key)) UI.go(key, {}, true);
    }
  }
});
