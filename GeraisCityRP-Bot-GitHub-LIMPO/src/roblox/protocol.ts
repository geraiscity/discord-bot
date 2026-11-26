export function acceptsProtocol(body:Record<string,unknown>,requireV2:boolean,now=Date.now()):boolean{
 if(body.protocol!==2)return !requireV2 && body.protocol===undefined;
 return typeof body.sentAt==="number"&&Number.isFinite(body.sentAt)&&Math.abs(now-body.sentAt)<=120000&&typeof body.eventId==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.eventId);
}
