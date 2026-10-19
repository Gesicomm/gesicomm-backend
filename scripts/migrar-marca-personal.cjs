'use strict';
// Backfill explícito y reejecutable. No modifica usuarios, claves ni suscripciones de Gesicom.
const fs=require('node:fs/promises');
const path=require('node:path');
const {Usuario,sequelize}=require('../src/models');
const service=require('../src/services/marcaPersonal.service');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const directory=path.resolve(option('--dir','/migration'));
const planPath=path.join(directory,'plan.json');
const tables=['gesicom_sso_links','t2e_profiles','t2e_funnel_accounts','t2e_account_memberships'];
async function save(file,data){await fs.writeFile(file,JSON.stringify(data,null,2)+'\n',{mode:0o600});}
async function readTable(table){
  const rows=[];
  const order=table==='t2e_account_memberships'?'account_id,user_id':table==='gesicom_sso_links'?'gesicom_user_id':'id';
  for(let offset=0;;offset+=500){
    const response=await fetch(process.env.MARCA_PERSONAL_SUPABASE_URL+'/rest/v1/'+table+'?select=*&order='+order+'&limit=500&offset='+offset,{
      headers:{apikey:process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw Error('No se pudo respaldar/verificar '+table+' (HTTP '+response.status+').');
    const page=await response.json();rows.push(...page);if(page.length<500)return rows;
  }
}
async function snapshot(){const result={};for(const table of tables)result[table]=await readTable(table);return result;}
function originalRowsPreserved(before,after){
  const managed=new Set(before.gesicom_sso_links.map(row=>row.supabase_user_id));
  const originalProfiles=before.t2e_profiles.filter(row=>!managed.has(row.id));
  const originalProfileIds=new Set(originalProfiles.map(row=>row.id));
  const accountIds=new Set(before.t2e_funnel_accounts.map(row=>row.id));
  const memberships=before.t2e_account_memberships.filter(row=>originalProfileIds.has(row.user_id)&&accountIds.has(row.account_id));
  const preserved=(rows,current,key)=>{const lookup=new Map(current.map(row=>[key(row),row]));return rows.every(row=>JSON.stringify(lookup.get(key(row)))===JSON.stringify(row));};
  return preserved(originalProfiles,after.t2e_profiles,row=>row.id)
    &&preserved(before.t2e_funnel_accounts,after.t2e_funnel_accounts,row=>row.id)
    &&preserved(memberships,after.t2e_account_memberships,row=>row.account_id+':'+row.user_id);
}
async function main(){
  if(!service.configured())throw Error('El SSO no está configurado.');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  if(!args.includes('--apply')){
    try{await fs.access(planPath);throw Error('El plan ya existe; usar otro directorio para una nueva captura.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const users=await Usuario.findAll({attributes:['id'],order:[['id','ASC']]});
    const before=await snapshot();
    const linked=new Set(before.gesicom_sso_links.map(row=>Number(row.gesicom_user_id)));
    const ids=users.map(row=>Number(row.id));
    const eligible=[];
    for(const id of ids){if((await service.identity(id))?.enabled)eligible.push(id);}
    await save(path.join(directory,'before.json'),before);
    const plan={version:1,createdAt:new Date().toISOString(),project:process.env.MARCA_PERSONAL_SUPABASE_URL,ids,eligibleIds:eligible,linkedIds:ids.filter(id=>linked.has(id))};
    await save(planPath,plan);
    console.log(JSON.stringify({mode:'dry-run',users:ids.length,toCreate:ids.filter(id=>!linked.has(id)).length,alreadyLinked:plan.linkedIds.length,eligible:eligible.length,inactive:ids.length-eligible.length}));
    return;
  }
  const plan=JSON.parse(await fs.readFile(planPath,'utf8'));
  if(plan.version!==1||plan.project!==process.env.MARCA_PERSONAL_SUPABASE_URL||!Array.isArray(plan.ids)
     ||plan.ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(plan.ids).size!==plan.ids.length)throw Error('Plan de migración inválido.');
  const before=JSON.parse(await fs.readFile(path.join(directory,'before.json'),'utf8'));
  const limit=Number(option('--limit',plan.ids.length));
  if(!Number.isSafeInteger(limit)||limit<1)throw Error('Límite inválido.');
  const ids=plan.ids.slice(0,limit);
  const journal=path.join(directory,'journal.jsonl');
  const results=[];
  for(const id of ids){
    let result;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        const link=await service.provisionUser(id);
        result=link?{id,status:'linked',...link}:{id,status:'removed-from-source'};
        break;
      }catch(error){
        if(attempt<3&&error.status===503){await new Promise(resolve=>setTimeout(resolve,attempt*1500));continue;}
        // Registra sólo identificadores y estados; nunca tokens, contraseñas ni respuestas externas.
        result={id,status:'failed',httpStatus:error.upstreamStatus||error.status||503};
      }
    }
    results.push(result);await fs.appendFile(journal,JSON.stringify({at:new Date().toISOString(),...result})+'\n',{mode:0o600});
    if(results.length%10===0||results.length===ids.length)console.log(JSON.stringify({processed:results.length,total:ids.length,failed:results.filter(row=>row.status==='failed').length}));
  }
  const after=await snapshot();await save(path.join(directory,'after.json'),after);
  const links=new Map(after.gesicom_sso_links.map(row=>[Number(row.gesicom_user_id),row]));
  const profiles=new Map(after.t2e_profiles.map(row=>[row.id,row]));
  const mismatches=[];
  for(const result of results){
    if(result.status!=='linked')continue;
    const link=links.get(result.id),profile=link&&profiles.get(link.supabase_user_id);
    const memberships=link&&after.t2e_account_memberships.filter(row=>row.user_id===link.supabase_user_id);
    if(!link||!profile||profile.role!=='content'||Boolean(profile.active)!==result.enabled||profile.deleted_at
      ||memberships.length!==1||memberships[0].account_id!==link.account_id||profile.module_access?.includes('users'))mismatches.push(result.id);
  }
  const report={completedAt:new Date().toISOString(),sourceUsers:plan.ids.length,processed:results.length,
    linked:results.filter(row=>row.status==='linked').length,eligible:results.filter(row=>row.status==='linked'&&row.enabled).length,
    inactive:results.filter(row=>row.status==='linked'&&!row.enabled).length,
    removedFromSource:results.filter(row=>row.status==='removed-from-source').length,
    failures:results.filter(row=>row.status==='failed'),verificationMismatches:mismatches,
    originalT2ERowsPreserved:originalRowsPreserved(before,after)};
  await save(path.join(directory,'report.json'),report);console.log(JSON.stringify(report));
  if(report.failures.length||mismatches.length||!report.originalT2ERowsPreserved)process.exitCode=1;
}
main().catch(error=>{
  const key=process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY||'__missing__';
  const message=String(error.message||'Error').split(key).join('[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,240);
  console.error(JSON.stringify({migrationStopped:true,name:error.name,code:error.code,message}));process.exitCode=1;
})
  .finally(()=>sequelize.close());
