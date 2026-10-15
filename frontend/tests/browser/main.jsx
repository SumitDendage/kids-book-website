import React,{Component,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ADMIN} from '../../src/pages/Admin/index.js';
import {DEV} from '../../src/pages/Developer/index.js';
import Dashboard from '../../src/pages/Portal/Dashboard.jsx';
import SessionControls from '../../src/pages/Developer/SessionControls.jsx';
import {DashContext} from '../../src/pages/Portal/DashContext.js';
import {SECTION_PERMS,ADMIN_SECTIONS,DEV_SECTIONS} from '../../src/pages/Portal/dashboard.js';
import '../../src/styles/site.css';
import '../../src/styles/admin.css';
const pages=[...ADMIN_SECTIONS.map(([id,title])=>({id:'admin/'+id,title:'Admin: '+title,View:ADMIN[id]})),...DEV_SECTIONS.map(([id,title])=>({id:'developer/'+id,title:'Developer: '+title,View:DEV[id]})),{id:'developer/session-controls',title:'Developer: Customer sign-ins component',View:SessionControls}];
pages.push({id:'admin/shell',title:'Admin shell',View:Dashboard},{id:'developer/shell',title:'Developer shell',View:Dashboard});
const permissions=[...new Set(Object.values(SECTION_PERMS).flatMap(x=>Object.values(x).flat())),'catalogue.write','security.write','customers.write','messages.write','entitlements.grant','entitlements.revoke'];
const noop=()=>{};
const ctx={kind:'admin',me:{user:{id:'fixture',name:'UI test',email:'ui@example.test'},staff:{role:'owner',permissions}},can:p=>Array.isArray(p)?p.some(x=>permissions.includes(x)):permissions.includes(p),allowed:()=>true,toast:noop,go:noop,authLost:noop,refreshCounts:noop,setEditing:noop,setCustOpen:noop,site:{reloadCatalogue:noop},portalRef:{current:null},editing:null,custOpen:null,focus:null};
class Boundary extends Component{state={err:null};static getDerivedStateFromError(err){return{err};}render(){return this.state.err?<div role="alert" data-qa-crash>{this.state.err.message}</div>:this.props.children;}}
function App(){const [selected,setSelected]=useState(pages[0]);const[version,bump]=useState(0);const View=selected.View;return <div className="dash light" style={{minHeight:'100vh',height:'auto'}}><header style={{position:'sticky',top:0,zIndex:999,background:'#fff',color:'#111',padding:12}}><b>Isolated UI fixtures — no real account, network or writes</b><div><select id="qa-mode" aria-label="Fixture mode" onChange={()=>bump(version+1)} defaultValue="error"><option value="error">Missing backend</option><option value="empty">Empty response</option><option value="loading">Loading</option></select><select aria-label="Page" value={selected.id} onChange={e=>setSelected(pages.find(p=>p.id===e.target.value))}>{pages.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></div></header><main className="dash-main" style={{padding:24,display:'block'}}><h1 id="qa-title">{selected.title}</h1><DashContext.Provider value={{...ctx,kind:selected.id.split('/')[0]}}><Boundary key={selected.id+version}>{selected.id.endsWith('/shell')?<Dashboard kind={selected.id.split('/')[0]} me={ctx.me} site={{toast:noop}} portalRef={ctx.portalRef} onSwitch={noop} onBack={noop} onSignOut={noop} authLost={noop} reloadMe={noop}/>:<View/>}</Boundary></DashContext.Provider></main></div>}
createRoot(document.getElementById('root')).render(<App/>);
