import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveFolderMove} from "../../src/lib/ai/folder-move";
import {intentSchema,validateInstruction} from "../../src/lib/ai/assistant-contracts";
const intent=intentSchema.parse({action:"organize_page",page:"Salons",destination:"Mirpur",selection:"none",import:"none",filter:{logic:"and",groups:[]},changes:{},question:""});
const meta={pages:[{id:"page",name:"Salons",countryId:"pk"}],cities:[{id:"city",name:"Mirpur",country_id:"pk",country:"Pakistan"},{id:"other",name:"Mirpur",country_id:"ca",country:"Canada"}]};
test("city folder plans resolve the entire verified page inside its own country",()=>{assert.deepEqual(resolveFolderMove(intent,undefined,meta),{pageId:"page",cityId:"city"});assert.equal(validateInstruction(intent,"move the Salons page into the Mirpur city folder"),undefined);assert.ok(validateInstruction(intent,"show the Salons page"));});
test("folder plans reject ambiguous pages, missing cities, selections and lead filters",()=>{assert.throws(()=>resolveFolderMove(intent,undefined,{...meta,pages:[...meta.pages,{id:"second",name:"Salons",countryId:"pk"}]}));assert.throws(()=>resolveFolderMove({...intent,destination:"Imaginary"},undefined,meta));assert.throws(()=>resolveFolderMove({...intent,selection:"selected"},undefined,meta));assert.throws(()=>resolveFolderMove({...intent,filter:{logic:"and",groups:[{logic:"and",conditions:[{field:"phone",op:"missing",value:""}]}]}},undefined,meta));});
