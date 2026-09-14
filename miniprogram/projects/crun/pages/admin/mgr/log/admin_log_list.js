const createCatalog = require('../../../../biz/admin_catalog_biz.js');
Page(createCatalog({
  route: 'admin/log_list',
  menus: [{ label: '全部日志' }, { label: '系统', type: 'type', value: 0 }, { label: '用户', type: 'type', value: 1 }, { label: '公告', type: 'type', value: 2 }, { label: '其他', type: 'type', value: 99 }],
  data: { searchPlaceholder: '搜索操作内容、账号或姓名', countUnit: '条日志', emptyTitle: '暂无符合条件的操作日志', emptyHint: '管理员的操作记录会显示在这里' }
}, {
  bindClearTap() {
    if (!this.data.isSuperAdmin) return;
    return this.mutate('admin/log_clear', {}, { title: '清空操作日志', content: '确认清空全部操作日志？清空后无法恢复。' });
  }
}));
