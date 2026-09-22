const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');

function makeSb(cfg){
  const log={rpc:[],inserts:[]};
  const builder=(table)=>{
    let mode='select',payload=null,filters={};
    let px;
    const b={
      select(){return px;},order(){return px;},limit(){return px;},maybeSingle(){return px;},single(){return px;},
      eq(col,val){filters[col]=val;return px;},
      insert(p){mode='insert';payload=p;log.inserts.push({table,p});return px;},
      then(res,rej){
        let out;
        if(mode==='select'){
          if(table==='viagens')out={data:cfg.viagens||[],error:null};
          else if(table==='viagem_membros')out={data:(cfg.membros||[]).filter(m=>m.viagem_id===filters.viagem_id),error:null};
          else if(table==='categorias')out={data:[],error:null};
          else if(table==='reservas')out={data:[],error:null};
          else if(table==='subscriptions')out={data:cfg.subscriptions||null,error:null};
          else if(table==='documentos')out={data:null,count:0,error:null};
          else out={data:[],error:null};
        } else out={data:{id:'x',...payload},error:null};
        return Promise.resolve(out).then(res,rej);
      }
    };
    px=new Proxy(b,{get:(t,k)=>k in t?t[k]:(()=>px)});
    return px;
  };
  return {log,client:{
    auth:{
      getSession:async()=>({data:{session:{user:{id:cfg.uid,email:cfg.email},access_token:'tok'}}}),
      onAuthStateChange:()=>{},signInWithPassword:async()=>({}),signUp:async()=>({}),signOut:async()=>({})
    },
    from:builder,
    rpc:async(fn,args)=>{
      log.rpc.push({fn,args});
      return cfg.rpc(fn,args);
    },
    storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'x'}})})}
  }};
}

async function boot(cfg){
  const errors=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push('jsdomError: '+(e.detail&&e.detail.message||e.message)));
  const {log,client}=makeSb(cfg);
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://wayfin.test/',pretendToBeVisual:true,virtualConsole:vc,
    beforeParse(w){
      w.supabase={createClient:()=>client};
      w.L={map:()=>({}),tileLayer:()=>({addTo(){}})};
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
      w.fetch=async()=>({ok:false,status:404,json:async()=>({})});
      w.confirm=()=>true;
    }});
  await new Promise(r=>setTimeout(r,400));
  return {w:dom.window,errors,log};
}
let fails=0;
const ok=(c,m)=>{console.log((c?'  ✔ ':'  ✘ ')+m);if(!c)fails++;};

(async()=>{
  console.log('\n[1] Rafael é dono de uma viagem compartilhada (v.owner_id === meu id)');
  let t=await boot({
    uid:'rafael-uid',email:'raf.fcp@gmail.com',
    viagens:[{id:'v1',nome:'Lisboa',orcamento:1000,owner_id:'rafael-uid'}],
    subscriptions:{plan:'manual',status:'active',current_period_end:null},
    membros:[{id:'m1',viagem_id:'v1',email:'gabi@example.com',papel:'editor',status:'aceito'}],
    rpc:(fn,args)=>{
      if(fn==='convidar_membro'){
        
        return {data:{id:'m2',viagem_id:args.p_viagem_id,email:args.p_email,papel:args.p_papel,status:'aceito'},error:null};
      }
      if(fn==='remover_membro')return{data:null,error:null};
      return {data:null,error:{message:'fn desconhecida'}};
    }
  });
  const w=t.w;
  ok(t.errors.length===0,'boot sem erros de runtime '+(t.errors.length?JSON.stringify(t.errors.slice(0,3)):''));
  ok(!!w.document.getElementById('mem-btn'),'botão 🤝 existe no topo');
  w.document.getElementById('mem-btn').click();
  await new Promise(r=>setTimeout(r,50));
  ok(w.document.getElementById('omem').classList.contains('on'),'modal de membros abre');
  ok(w.document.getElementById('mem-invite').style.display==='block','dono vê formulário de convite');
  ok(w.document.getElementById('mem-readonly').style.display==='none','dono não vê aviso somente-leitura');
  ok(w.document.querySelectorAll('.mem-row').length===1,'lista mostra 1 membro (Gabi)');
  ok(w.document.querySelector('.mem-email').textContent==='gabi@example.com','e-mail da Gabi aparece');
  ok(w.document.querySelector('.mem-meta').textContent.includes('Acesso ativo'),'status "Acesso ativo" exibido');

  // convite de e-mail novo (auto-aceito pelo RPC simulado)
  w.document.getElementById('meminput').value='novo@example.com';
  w.document.getElementById('memaddbtn').click();
  await new Promise(r=>setTimeout(r,50));
  ok(t.log.rpc.some(r=>r.fn==='convidar_membro'&&r.args.p_email==='novo@example.com'),'RPC convidar_membro chamado com o e-mail certo');

  console.log('\n[2] Gabi entra numa viagem do Rafael (ela é apenas membro, não dona)');
  t=await boot({
    uid:'gabi-uid',email:'gabi@example.com',
    viagens:[{id:'v1',nome:'Lisboa',orcamento:1000,owner_id:'rafael-uid'}],
    membros:[{id:'m1',viagem_id:'v1',email:'gabi@example.com',papel:'editor',status:'aceito'}],
    rpc:()=>({data:null,error:{message:'somente_o_dono_convida'}})
  });
  const g=t.w;
  ok(t.errors.length===0,'boot sem erros de runtime');
  ok([...g.document.querySelectorAll('.chip')].some(c=>c.querySelector('.chip-shared')),'chip da viagem mostra o badge 👥 (compartilhada)');
  g.document.getElementById('mem-btn').click();
  await new Promise(r=>setTimeout(r,50));
  ok(g.document.getElementById('mem-invite').style.display==='none','membro NÃO vê formulário de convite');
  ok(g.document.getElementById('mem-readonly').style.display==='block','membro vê aviso "somente o dono"');
  ok(g.document.querySelectorAll('.mem-row button').length===0,'membro não vê botão de remover');

  console.log('\n[3] Remover membro e erro amigável do RPC');
  t=await boot({
    uid:'rafael-uid',email:'raf.fcp@gmail.com',
    viagens:[{id:'v1',nome:'Lisboa',orcamento:1000,owner_id:'rafael-uid'}],
    membros:[{id:'m1',viagem_id:'v1',email:'gabi@example.com',papel:'editor',status:'pendente'}],
    rpc:(fn)=>fn==='remover_membro'?{data:null,error:null}:{data:null,error:{message:'x'}}
  });
  const r=t.w;
  r.document.getElementById('mem-btn').click();
  await new Promise(res=>setTimeout(res,50));
  ok(r.document.querySelector('.mem-meta.pendente')!==null&&r.document.querySelector('.mem-meta').textContent.includes('Aguardando cadastro'),'convite pendente mostra "Aguardando cadastro" em destaque');
  r.document.querySelector('.mem-row button').click();
  await new Promise(res=>setTimeout(res,50));
  ok(t.log.rpc.some(x=>x.fn==='remover_membro'&&x.args.p_membro_id==='m1'),'RPC remover_membro chamado com o id certo');

  ok(r.eval("friendlyMemberError('somente_o_dono_convida')").includes('Só o dono'),'mensagem amigável para somente_o_dono_convida');
  ok(r.eval("friendlyMemberError('nao_pode_convidar_a_si_mesmo')").includes('já tem acesso'),'mensagem amigável para auto-convite');

  console.log(fails?`\n✘ ${fails} falha(s)`:'\n✔ tudo passou');
  process.exit(fails?1:0);
})();
