export type RestoreScope="all"|"roles"|"channels";
export function mappedId(id:string,map:Record<string,string>,exists:(id:string)=>boolean):string|null {if(exists(id))return id;const replacement=map[id];return replacement&&exists(replacement)?replacement:null;}
export function latest<T extends {createdAt:number}>(items:(T|null)[]):T|null{return items.filter((v):v is T=>v!==null).sort((a,b)=>b.createdAt-a.createdAt)[0]??null;}
