'use strict';
// Shared parcel representation for the current three products. A future plugin
// can provide its own normalize/quote implementation without a parcel count.
function normalize(input, obj, config, tools, proof) {
 const {text,images,fail}=tools;
 obj.imgUrls = proof ? images(input.img || []) : [];
 obj.imgUrl = obj.imgUrls[0] || '';
 for (const name of ['small','medium','large']) { const raw = input[name] == null ? 0 : input[name]; if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw))) fail('快递件数必须为整数'); const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > config.maxPackages) fail('快递件数超出限制'); obj[name] = n; }
 obj.num = obj.small + obj.medium + obj.large; if (obj.num < 1 || obj.num > config.maxPackages) fail('package count invalid');
 let parcelItems = input.packages;
 if (typeof parcelItems === 'string' && parcelItems.trim()) { try { parcelItems = JSON.parse(parcelItems); } catch (_) { fail('package proof invalid'); } }
 if (parcelItems == null) parcelItems = [];
 if (!Array.isArray(parcelItems) || parcelItems.length > config.maxPackages) fail('package proof count invalid');
 if (parcelItems.length) {
  const counts = { small:0, medium:0, large:0 };
  // Normalize payloads from older clients into the same per-parcel representation.
  const legacyPickup = parcelItems.some(item => item && Object.prototype.hasOwnProperty.call(item,'pickupPoint')) ? '' : text(input.address1 || '', '取件点', 100, false);
  parcelItems = parcelItems.map((item, index) => { if (!item || !['small','medium','large'].includes(item.type)) fail('package type invalid'); counts[item.type]++; const price = Number(item.price); if (!Number.isFinite(price) || price < 0.01 || price > 10000) fail('package price invalid'); const pickupPoint = text(item.pickupPoint == null ? legacyPickup : item.pickupPoint, '第' + (index + 1) + '件包裹的取件点', 100, true); const code = proof ? text(item.code || '','code',200,false) : ''; const note = text(item.note || '','note',300,false); const packageImages = proof ? images(item.images || []) : []; if (code && packageImages.length) fail('package proof must choose code or image'); return { type:item.type, price:Number(price.toFixed(2)), pickupPoint, code, note, images:packageImages }; });
  if (counts.small !== obj.small || counts.medium !== obj.medium || counts.large !== obj.large) fail('package proof count mismatch');
  obj.packages = parcelItems;
  obj.address1 = [...new Set(parcelItems.map(item => item.pickupPoint))].join('；');
 } else { obj.packages = []; obj.address1 = text(input.address1 || '', '取件点', 100, true); }
 const packageCodes = obj.packages.map(item => item.code).filter(Boolean);
 const packageImages = obj.packages.reduce((all, item) => all.concat(item.images || []), []);
 if (obj.imgUrls.length + packageImages.length > 6) fail('\u56fe\u7247\u5fc5\u987b\u5148\u6210\u529f\u4e0a\u4f20\uff0c\u6700\u591a6\u5f20');
 if (!obj.code && packageCodes.length) obj.code = packageCodes.join('\n');
 if (!obj.imgUrls.length && packageImages.length) { obj.imgUrls = packageImages.slice(0, 6); obj.imgUrl = obj.imgUrls[0] || ''; }
 if (proof && !obj.code && !obj.imgUrls.length) fail('\u8bf7\u586b\u5199\u53d6\u4ef6\u7801\u6216\u4e0a\u4f20\u53d6\u4ef6\u622a\u56fe');
 const referenceFee = obj.small * Math.round(config.smallPrice * 100) + obj.medium * Math.round(config.mediumPrice * 100) + obj.large * Math.round(config.largePrice * 100);
 let totalFee = obj.packages.length ? Math.round(obj.packages.reduce((sum, item) => sum + item.price * 100, 0)) : referenceFee;
 if (input.price !== undefined && input.price !== null && input.price !== '') {
  const value = Number(input.price);
  if (!Number.isFinite(value) || value < 0.01 || value > 10000 || !/^\d+(?:\.\d{1,2})?$/.test(String(input.price).trim())) fail('费用须在0.01至10000元之间，最多保留两位小数');
  if (!obj.packages.length) totalFee = Math.round(value * 100);
 }
 obj.price = totalFee / 100; obj.referencePrice = referenceFee / 100;
 return { totalFee, referenceFee };
}
module.exports={normalize};
