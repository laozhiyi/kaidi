'use strict';
// Seed data for an existing GXNU installation only. Runtime UI and validation
// read the directory; adding a school never requires changing this file.
module.exports = {
  schoolId: 'gxnu', name: '广西师范大学',
  campuses: [
    { campusId: 'yucai', name: '育才校区' },
    { campusId: 'wangcheng', name: '王城校区' },
    { campusId: 'yanshan', name: '雁山校区' }
  ],
  locations: { phases: ['一期', '二期', '三期', '四期', '五期'], pickupStations: [
    { name: '二期', list: ['中通', '圆通', '申通', '韵达', '顺丰'] },
    { name: '五期', list: ['邮政', '极兔'] }, { name: '奥林苑', list: ['京东'] }
  ] }
};
