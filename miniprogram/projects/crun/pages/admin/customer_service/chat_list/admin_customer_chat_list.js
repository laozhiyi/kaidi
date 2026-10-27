const createCatalog = require('../../../../biz/admin_catalog_biz.js');
Page(createCatalog({
  route: 'admin/customer_service_sessions',
  data: {
    searchPlaceholder: '搜索昵称或 openid',
    countUnit: '条会话',
    emptyTitle: '暂无咨询会话',
    emptyHint: '用户发起咨询后，会话会显示在这里'
  },
  format: row => ({ ...row, _id: row.CSM_SESSION_ID })
}));
