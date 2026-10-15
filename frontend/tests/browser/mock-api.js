export const API_BASE='http://127.0.0.1:5180/fixture-only';
export const apiUrl=p=>API_BASE+p;
export const staffTokens={get:()=>({accessToken:'fixture-no-real-access'})};
export const calls=[];
export function mode(){return document.querySelector('#qa-mode')?.value||'error';}
export async function staffApi(method,path,body){
 calls.push({method,path});
 if(method!=='GET') throw new Error('Writes are disabled in this isolated fixture');
 if(mode()==='loading') return new Promise(()=>{});
 if(mode()==='error') throw Object.assign(new Error('Requested function was not found'),{status:404,code:'NOT_FOUND'});
 if(path.startsWith('/api/admin/developer/health')) return {version:'fixture',db:{latencyMs:0},payments:{events24h:0,notOk24h:0},outbox:{sent24h:0,failed24h:0}};
 return {range:{from:0,to:1000,tz:'UTC'},totals:{revenueInr:0,paidOrders:0,visitors:0,pageViews:0,signups:0,verifiedSignups:0,sheetOpens:0,searches:0},conversion:{},db:{},payments:{},outbox:{},worksheets:[],classes:[],files:[],missing:[],orders:[],users:[],customers:[],messages:[],coupons:[],faq:[],reviews:[],staff:[],audit:[],log:[],logs:[],payments:[],events:[],emails:[],notifications:[],appeals:[],warnings:[],incidents:[],rules:[],sessions:[],settings:{},content:{},home:{},total:0,unread:0,plans:[],counts:{}};
}
export const staffFetch=async()=>new Response(JSON.stringify({message:'Fixture only'}),{status:404});
export const authFetch=staffFetch;
export const staffAuth={me:async()=>({user:{id:'fixture',name:'UI test',email:'ui@example.test'},staff:{role:'owner',permissions:[]}}),signedIn:()=>false,logout:async()=>{}};
export const authApi={updateMe:async()=>{throw new Error('Fixture writes disabled');}};
export const meApi={};
export const fetchConfig=async()=>({});
