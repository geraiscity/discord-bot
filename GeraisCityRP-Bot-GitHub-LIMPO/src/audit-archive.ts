import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { saveAuditArchive } from "./persistence.js";
let failed=0;
export function archiveHealth(){return {failed};}
export async function archiveAudit(guildId:string,id:string,at:number,payload:unknown):Promise<void>{
 if(!/^\d{15,22}$/.test(guildId)){failed++;return;}
 const dir=resolve(".data","audit",guildId);
 const disk=(async()=>{await mkdir(dir,{recursive:true});await appendFile(resolve(dir,new Date(at).toISOString().slice(0,10)+".jsonl"),JSON.stringify({id,at,payload})+"\n",{mode:0o600});return true;})().catch(()=>false);
 const [a,b]=await Promise.all([disk,saveAuditArchive(guildId,id,at,payload).catch(()=>false)]);
 if(!a&&!b)failed++;
}
