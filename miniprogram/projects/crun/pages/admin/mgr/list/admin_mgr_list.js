const createCatalog = require('../../../../biz/admin_catalog_biz.js');
Page(createCatalog({
  route: 'admin/mgr_list', superOnly: true,
  menus: [{ label: '全部账号' }, { label: '超级管理员', type: 'type', value: 1 }, { label: '普通管理员', type: 'type', value: 0 }, { label: '正常', type: 'status', value: 1 }, { label: '已停用', type: 'status', value: 0 }],
  data: { searchPlaceholder: '搜索账号、姓名或手机', countUnit: '个账号', emptyTitle: '暂无符合条件的管理员' },
  format: row => ({ ...row, ADMIN_TYPE: Number(row.ADMIN_TYPE), ADMIN_STATUS: Number(row.ADMIN_STATUS) })
}, {
  bindStatusTap(e) {
    const { id } = e.currentTarget.dataset, status = Number(e.currentTarget.dataset.status);
    if (!id || ![0, 1].includes(status)) return;
    return this.mutate('admin/mgr_status', { id, status }, { title: status ? '启用管理员' : '停用管理员', content: status ? '启用后该账号可以登录管理后台。' : '停用后该账号无法登录管理后台，已有操作记录保留。' });
  },
  bindDelTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) return this.mutate('admin/mgr_del', { id }, { title: '删除管理员', content: '确认删除此管理员账号？删除后无法恢复。' });
  }
}));
