const Ops = require('./operations_biz.js');
// The client never reads a database collection directly. The cloud endpoint
// resolves the campus and returns only its bounded set of opaque revisions.
function watch({scope,onChange,onError}) {
  let closed=false,timer=null;
  const handle={close(){closed=true;if(timer!==null)clearTimeout(timer);timer=null;}};
  async function poll(){
    try {
      const value=await Ops.get('operations/feed',{},scope);
      if(closed)return;
      if(!value||!Array.isArray(value.docs)||value.docs.length>64)throw new Error('订单刷新信号无效');
      onChange({docs:value.docs});
      if(!closed)timer=setTimeout(poll,10000+Math.floor(Math.random()*2000));
    }catch(error){if(!closed)onError(error);}
  }
  Promise.resolve().then(poll);
  return handle;
}
module.exports={watch};
