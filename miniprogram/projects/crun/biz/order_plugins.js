const parcel={form:'parcel-fields',extraFields:[],validate(){}};
const plugins={
 take:{...parcel,name:'快递代取',proof:true},
 send:{...parcel,name:'物品代送',proof:false},
 buy:{name:'商品代买',form:'buy-fields',proof:false,extraFields:['goods','buyQuantity','goodsBudget'],validate(values){
  if(!String(values.goods||'').trim() || String(values.goods).trim().length>500)throw new Error('请填写商品及规格，最多500字');
  if(!/^[1-9]\d?$/.test(String(values.buyQuantity||'')))throw new Error('购买数量须为1至99的整数');
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(values.goodsBudget||'')) || Number(values.goodsBudget)<0.01 || Number(values.goodsBudget)>10000)throw new Error('商品预算须在0.01至10000元之间，最多保留两位小数');
 }}
};
function get(type){if(!Object.prototype.hasOwnProperty.call(plugins,type))throw new Error('服务类型无效');return plugins[type];}
module.exports={get,names:Object.fromEntries(Object.entries(plugins).map(([key,value])=>[key,value.name]))};
