// Keep group numbers as strings; legacy WeChat QR/text must not become QQ contacts.
const DEFAULT_NUMBER = '856190901';
const NUMBER_RE = /^[1-9]\d{4,11}$/;
function read(content) {
 const nodes = Array.isArray(content) ? content : [];
 const text = nodes.filter(node => node && node.type === 'text' && typeof node.val === 'string').map(node => node.val.trim());
 let number = '', note = '';
 for (const value of text) {
  const match = /^QQ\s*群号\s*[：:]\s*([1-9]\d{4,11})\s*$/i.exec(value);
  if (match) number = match[1];
  if (/^加群说明\s*[：:]/.test(value)) note = value.replace(/^加群说明\s*[：:]\s*/, '').slice(0, 200);
 }
 return {number:number || DEFAULT_NUMBER, note:number ? note : '', configured:!!number};
}
function build(number, note = '') {
 number = String(number || '').trim();
 if (!NUMBER_RE.test(number)) throw new Error('请填写正确的 QQ 群号（5至12位数字）');
 const content = [{type:'text',val:'QQ 群号：' + number}];
 note = String(note || '').trim();
 if (note.length > 200) throw new Error('加群说明最多200字');
 if (note) content.push({type:'text',val:'加群说明：' + note});
 return content;
}
module.exports = {DEFAULT_NUMBER, read, build};
