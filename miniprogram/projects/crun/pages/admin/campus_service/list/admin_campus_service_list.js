const createCatalog = require('../../../../biz/admin_catalog_biz.js');
Page(createCatalog({
  route: 'admin/campus_service_list',
  menus: [{ label: '全部客服' }, { label: '已启用', type: 'status', value: 1 }, { label: '已停用', type: 'status', value: 0 }],
  data: { campusOptions: ['当前校区'], searchPlaceholder: '搜索校区或负责人', countUnit: '位客服', emptyTitle: '暂无符合条件的客服', emptyHint: '可添加校区客服，配置联系方式与服务时间' },
  format: row => ({ ...row, CS_STATUS: Number(row.CS_STATUS) })
}, {
  bindStatusMoreTap(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showActionSheet({
      itemList: ['启用客服', '停用客服', '删除客服'],
      success: result => {
        if (result.tapIndex < 2) return this.mutate('admin/campus_service_status', { id, status: result.tapIndex === 0 ? 1 : 0 });
        if (result.tapIndex === 2) return this.mutate('admin/campus_service_del', { id }, { title: '删除校区客服', content: '确认删除此客服配置？已有对话消息的客服不能删除，可改为停用以保留历史。' });
      }
    });
  }
}));
