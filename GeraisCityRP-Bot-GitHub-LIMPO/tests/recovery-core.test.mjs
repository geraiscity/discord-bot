import test from "node:test";import assert from "node:assert/strict";import {mappedId,latest} from "../src/backups/recovery-core.ts";
test("reutiliza ID recriado",()=>{assert.equal(mappedId("old",{old:"new"},id=>id==="new"),"new");assert.equal(mappedId("old",{old:"new"},()=>false),null);});
test("seleciona backup mais recente",()=>{assert.deepEqual(latest([{createdAt:1},{createdAt:2}]),{createdAt:2});});
