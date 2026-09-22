'use strict';
const parcel=require('./parcel.js');
module.exports={id:'3',key:'buy',name:'商品代买',version:1,publicFields:['goods','buyQuantity','goodsBudget'],
 normalize(input,obj,config,tools){const {text,fail}=tools;
  obj.goods = text(input.goods, '购买要求', 500, true);
  if (!/^[1-9]\d?$/.test(String(input.buyQuantity))) fail('购买数量须为1至99的整数');
  obj.buyQuantity = Number(input.buyQuantity);
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(input.goodsBudget)) || Number(input.goodsBudget) < 0.01 || Number(input.goodsBudget) > 10000) fail('商品预算须在0.01至10000元之间，最多保留两位小数');
  obj.goodsBudget = Number(input.goodsBudget);
 return parcel.normalize(input,obj,config,tools,false);
 }};
