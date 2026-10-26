'use strict';
// Seed data for an existing GXNU installation only. Runtime UI and validation
// read the directory; adding a school never requires changing this file.
//
// 雁山校区地点表取自《广西师范大学雁山校区地图》（2022 年 8 月制）。
// 顺序与地图图例编号一致，便于运营核对；名称去掉了括号里的说明，
// 简称仅用于「环境与资源学院实验教学中心」（地图原名过长，放不进选项格）。
// 前端同名副本见 miniprogram/projects/crun/biz/address_biz.js，两处必须同步。
const YANSHAN_PHASES = [
  '东大门', '校训石', '图书馆', '纯道楼', '静园', '诚园', '群园', '雅园', '北门', '怡园',
  '荟文楼', '独秀书房', '孔子广场', '明志楼', '桃园餐厅', '起文楼', '公共体育馆', '田径游泳馆',
  '体育馆', '室外训练场', '标准体育场', '西门', '综合体育馆', '训练馆', '音乐楼', '大学生创新创业中心',
  '环资学院实验中心', '伯康楼', '物理实验楼', '计算机实验楼', '数学实验楼', '电子工程实验楼',
  '校医院', '容园', '荷园餐厅', '创新创业学院', '恬园', '知园', '德园', '厚藩楼', '体育场', '校友林', '奥林苑'
];

module.exports = {
  schoolId: 'gxnu', name: '广西师范大学',
  campuses: [
    { campusId: 'yucai', name: '育才校区' },
    { campusId: 'wangcheng', name: '王城校区' },
    { campusId: 'yanshan', name: '雁山校区' }
  ],
  locations: {
    phases: YANSHAN_PHASES,
    pickupStations: [
      { name: '雅园', list: ['中通', '圆通', '申通', '韵达', '顺丰'] },
      { name: '知园', list: ['邮政', '极兔'] },
      { name: '奥林苑', list: ['京东'] }
    ]
  },
  YANSHAN_PHASES
};
