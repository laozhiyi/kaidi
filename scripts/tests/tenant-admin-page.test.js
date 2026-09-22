'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('../test-support/admin-console-harness.cjs');
const pagePath='tenants/admin_tenants.js';
const schools=[{schoolId:'school_a',name:'学校 A',enabled:true,version:1}];
const campuses=['east','west'].map(campusId=>({schoolId:'school_a',campusId,name:campusId,enabled:true,version:1}));
const admins=['first','second'].map(_id=>({_id,name:_id,type:1,status:1,platform:false}));
const detail=(campus,phase)=>({...campus,locations:{phases:[phase],pickupStations:[]}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('tenant administration loads only the selected campus and account details',async()=>{
  const h=harness(pagePath,(route,params)=>{
    if(route==='admin/tenant_directory')return {schools,campuses,admins};
    if(route==='admin/tenant_campus_detail')return detail(campuses.find(x=>x.campusId===params.value.campusId),'东苑');
    if(route==='admin/tenant_account_detail')return {scopes:[{schoolId:'school_a',campusId:'*'}],type:1};
    throw Error('Unexpected request');
  });
  await h.page.onLoad();
  assert.equal(h.calls.length,3);assert.equal(h.page.data.phaseText,'东苑');
  assert.equal(h.page.data.grantText,'school_a/*');assert.equal(h.page.data.adminReady,true);
  assert.equal(h.page.data.loading,false);
});

test('late campus and account details cannot replace the current selection',async()=>{
  const campusOld=deferred(),campusNew=deferred(),adminOld=deferred(),adminNew=deferred();
  const h=harness(pagePath,(route,params)=>route==='admin/tenant_campus_detail'
    ? (params.value.campusId==='east'?campusOld:campusNew).promise
    : (params.adminId==='first'?adminOld:adminNew).promise);
  const oldCampus=h.page.selectCampus(campuses[0]),nextCampus=h.page.selectCampus(campuses[1]);
  const oldAdmin=h.page.selectAdmin(admins[0]),nextAdmin=h.page.selectAdmin(admins[1]);
  campusNew.resolve(detail(campuses[1],'西苑'));adminNew.resolve({scopes:[{schoolId:'school_a',campusId:'west'}],type:0});
  await Promise.all([nextCampus,nextAdmin]);
  campusOld.resolve(detail(campuses[0],'东苑'));adminOld.resolve({scopes:[{schoolId:'school_a',campusId:'*'}],type:1});
  await Promise.all([oldCampus,oldAdmin]);
  assert.equal(h.page.data.campus.campusId,'west');assert.equal(h.page.data.phaseText,'西苑');
  assert.equal(h.page.data.grantText,'school_a/west');assert.equal(h.page.data.grantManager,false);
});

test('failed detail loading prevents accidental clearing and can be retried',async()=>{
  let fail=true;
  const h=harness(pagePath,(route)=>{
    if(fail)throw Error('网络异常');
    return route==='admin/tenant_campus_detail'?detail(campuses[0],'东苑'):{scopes:[{schoolId:'school_a',campusId:'east'}],type:1};
  });
  h.page.setData({admins,adminIndex:0});
  await Promise.all([h.page.selectCampus(campuses[0]),h.page.selectAdmin(admins[0])]);
  assert.match(h.page.data.campusError,/网络/);assert.match(h.page.data.adminError,/网络/);
  await h.page.saveCampus();await h.page.saveGrant();assert.equal(h.calls.length,2);
  fail=false;await Promise.all([h.page.retryCampus(),h.page.retryAdmin()]);
  assert.equal(h.page.data.phaseText,'东苑');assert.equal(h.page.data.adminReady,true);
  assert.equal(h.page.data.campusError,'');assert.equal(h.page.data.adminError,'');
});
