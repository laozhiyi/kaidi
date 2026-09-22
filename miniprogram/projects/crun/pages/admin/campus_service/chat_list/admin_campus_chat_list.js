const createCatalog = require('../../../../biz/admin_catalog_biz.js');
Page(createCatalog({
  route: 'admin/campus_chat_list',
  data: { campusOptions: ['当前校区'], searchPlaceholder: '搜索校区、负责人或用户', countUnit: '条会话', emptyTitle: '暂无符合条件的会话', emptyHint: '用户发起咨询后，会话会显示在这里' },
  format: row => ({ ...row, _id: row._id || row.CSM_SESSION_ID })
}));
