/** Bounded concurrency: protects memory during bursts. Overflow is explicit. */
export class WorkQueue {
  private active=0;
  private waiting: (()=>void)[]=[];
  private dropped=0;
  private failed=0;
  private concurrency:number;
  private capacity:number;
  constructor(concurrency=4,capacity=500){if(concurrency<1||capacity<1)throw Error("Invalid queue limits");this.concurrency=concurrency;this.capacity=capacity;}
  submit(task:()=>Promise<void>):boolean{
    if(this.waiting.length+this.active>=this.capacity){this.dropped++;return false;}
    this.waiting.push(()=>{this.active++;void Promise.resolve().then(task).catch(()=>{this.failed++;}).finally(()=>{this.active--;this.pump();});});
    this.pump();return true;
  }
  private pump(){while(this.active<this.concurrency&&this.waiting.length)this.waiting.shift()!();}
  stats(){return {active:this.active,waiting:this.waiting.length,dropped:this.dropped,failed:this.failed};}
}
export const auditQueue=new WorkQueue(4,1000);
export const bridgeQueue=new WorkQueue(4,1000);
