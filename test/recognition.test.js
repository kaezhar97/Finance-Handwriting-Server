import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateDocument, validateAmount, validateProfile, decodeModelResponse, createRateLimiter } from '../lib/contract.js';
import { mergeAlignedPasses } from '../lib/consensus.js';
import { recognizePage, buildImageContent } from '../lib/recognition.js';
import { createHandler } from '../api/recognize.js';
import { MASTER_PROMPT } from '../lib/prompt.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n6kAAAAASUVORK5CYII=';
const page = amount => ({
    title: 'January 2027',

    titleRegion: {
        x: 350,
        y: 40,
        width: 300,
        height: 80
    },

    sections: [
        {
            heading: 'Income',
            semanticKind: 'income',

            groups: [
                {
                    name: '',

                    items: [
                        {
                            label: 'Salary',
                            amount,

                            amountRegion: {
                                x: 650,
                                y: 250,
                                width: 150,
                                height: 60
                            },

                            semanticKind:
                                'income'
                        }
                    ]
                }
            ]
        }
    ]
});
const clone = value => structuredClone(value);
const request = {imageBase64:png};
function fakeClient(documents) { const calls=[];return { calls, responses:{create:async(body,options)=>{calls.push({body,options});return {status:'completed',model:'actual-model-id',output_text:JSON.stringify(documents[calls.length-1] ?? documents[0])};}} }; }
const response = () => ({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
test('request accepts complete PNG and explicit v1 version',()=>assert.equal(validateRequest({...request,schemaVersion:'whole-page-request-v1'}).imageBase64,png));
test('reject missing, malformed, oversized and unsupported image inputs',()=>{for(const body of [{}, {imageBase64:'abc'}, {imageBase64:'A'.repeat(3_000_004)}, {...request,schemaVersion:'v9'}, 'not json',null])assert.throws(()=>validateRequest(body));});
test('reject total payload over limit',()=>assert.throws(()=>validateRequest({...request,unused:'x'.repeat(4_000_000)})));
test('reject image dimension bombs',()=>{const data=Buffer.from(png,'base64');data.writeUInt32BE(20000,16);assert.throws(()=>validateRequest({imageBase64:data.toString('base64')}));});
test('profile is bounded and reduced to explicit correction fields',()=>{const p=validateProfile({version:1,corrections:[{kind:'amount',recognized:'125',corrected:'185',extra:'discard'}]});assert.equal(p.corrections[0].extra,undefined);assert.throws(()=>validateProfile({version:1,corrections:Array(21).fill(p.corrections[0])}));assert.throws(()=>validateProfile({version:1,corrections:[{kind:'bad',recognized:'1',corrected:'2'}]}));});
test('reference optional and validated',()=>{assert.equal(validateRequest({...request,handwritingReferenceBase64:png}).handwritingReferenceBase64,png);assert.throws(()=>validateRequest({...request,handwritingReferenceBase64:'bad'}));});
test('amounts preserve zero, decimals, negatives, trailing zero and long balance',()=>{for(const v of ['0','-35.42','8500','1000.00','208300','999999999999.99'])assert.equal(validateAmount(v),true);});
test('invalid amounts are rejected without cleanup',()=>{for(const v of ['1,000','1000 1000','1.234','1e4','NaN','1000000000000','',null])assert.equal(validateAmount(v),false);});
test('arbitrary labels and empty documents are valid',()=>{const p=page('90');p.sections[0].heading='DOG';p.sections[0].groups[0].items[0].label='Vet';assert.equal(validateDocument(p),p);assert.doesNotThrow(()=>validateDocument({title:'',sections:[]}));});
test('malformed structures, semantics and excessive items rejected',()=>{for(const p of [{title:'x'}, {title:'x',sections:[null]},page('bad')])assert.throws(()=>validateDocument(p));const p=page('1');p.sections[0].semanticKind='invented';assert.throws(()=>validateDocument(p));const q=page('1');q.sections[0].groups[0].items=Array(201).fill(q.sections[0].groups[0].items[0]);assert.throws(()=>validateDocument(q));});
test('unanimous consensus',()=>{const result=mergeAlignedPasses([page('420'),page('420'),page('420')]);assert.equal(result.needsAdjudication,false);assert.equal(result.disagreements.length,0);});
test('equivalent normalized money agrees',()=>assert.equal(mergeAlignedPasses([page('420'),page('420.0'),page('420.00')]).disagreements.length,0));
test('majority chooses two matching amounts',()=>{const r=mergeAlignedPasses([page('410'),page('420'),page('420')]);assert.equal(r.document.sections[0].groups[0].items[0].amount,'420');assert.equal(r.disagreements.length,1);assert.equal(r.needsAdjudication,false);});
test('three-way disagreement requires adjudication',()=>assert.equal(mergeAlignedPasses([page('410'),page('420'),page('470')]).needsAdjudication,true));
test('material structural mismatch requires adjudication',()=>{const p=page('420');p.sections[0].groups[0].items[0].label='Side gig';assert.equal(mergeAlignedPasses([page('420'),page('420'),p]).disagreements[0].path,'__document_structure__');});
test('case whitespace punctuation and reordered rows align without altering displayed labels',()=>{const a=page('420');a.sections[0].groups[0].items.push({label:'Side gig',amount:'100',semanticKind:'income'});const b=clone(a);b.sections[0].heading='  INCOME! ';b.sections[0].groups[0].items.reverse();const r=mergeAlignedPasses([a,b,clone(a)]);assert.equal(r.needsAdjudication,false);assert.equal(r.document.sections[0].heading,'Income');});
test('ambiguous duplicate paths require image adjudication',()=>{const p=page('1');p.sections[0].groups[0].items.push(clone(p.sections[0].groups[0].items[0]));assert.equal(mergeAlignedPasses([p,p,p]).needsAdjudication,true);});
test('refusal incomplete malformed and missing output are rejected',()=>{for(const r of [{status:'incomplete',output_text:'{}'},{status:'completed',output_text:'bad'},{status:'completed'},{status:'completed',output_text:JSON.stringify(page('1')),output:[{content:[{type:'refusal'}]}]}])assert.throws(()=>decodeModelResponse(r));});
test('three independent reads retain prompt store:false and strict schema',async()=>{const client=fakeClient([page('420')]);const r=await recognizePage({client,model:'gpt-5.6',request});assert.equal(client.calls.length,3);assert.equal(r.consensus.strategy,'unanimous');assert.equal(r.provenance.passCount,3);assert.equal(r.provenance.model,'actual-model-id');for(const {body} of client.calls){assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.ok(body.input[0].content.some(c=>c.text===MASTER_PROMPT));}});
test('fourth read sees original image plus three candidates and returns provenance',async()=>{const client=fakeClient([page('1'),page('2'),page('3'),page('420')]);const r=await recognizePage({client,model:'gpt-5.6',request});assert.equal(client.calls.length,4);assert.equal(r.consensus.strategy,'adjudicated');assert.equal(r.provenance.passCount,4);assert.equal(r.document.sections[0].groups[0].items[0].amount,'420');assert.ok(client.calls[3].body.input[0].content.some(c=>c.type==='input_image'));assert.match(client.calls[3].body.input[0].content[0].text,/Candidate pass 3/);});
test('reference image carries glyph-only instructions',()=>{const c=buildImageContent({...request,handwritingReferenceBase64:png});assert.equal(c.filter(c=>c.type==='input_image').length,2);assert.match(c[2].text,/ONLY/);});
test('rate limit expires and bounds bursts',()=>{let now=0;const limit=createRateLimiter({now:()=>now,maximum:2});assert.equal(limit('a'),false);assert.equal(limit('a'),false);assert.equal(limit('a'),true);now=60000;assert.equal(limit('a'),false);});
test('health does not need credentials or call OpenAI',async()=>{const res=response();await createHandler({clientProvider:()=>{throw Error('must not call');}})({method:'GET'},res);assert.equal(res.code,200);assert.equal(res.body.mode,'whole-page-consensus');});
test('handler rejects methods malformed requests and excessive bursts',async()=>{for(const [req,code] of [[{method:'DELETE'},405],[{method:'POST',body:'bad'},400]]){const res=response();await createHandler({rateLimit:()=>false})(req,res);assert.equal(res.code,code);}const res=response();await createHandler({rateLimit:()=>true})({method:'POST'},res);assert.equal(res.code,429);assert.equal(res.headers['Retry-After'],'60');});
test(
    'handler returns successful contract',
    async () => {
        const res =
            response();

        await createHandler({
            clientProvider:
                () =>
                    fakeClient([
                        page('420')
                    ]),

            rateLimit:
                () => false
        })(
            {
                method: 'POST',
                body: request
            },
            res
        );

        assert.equal(
            res.code,
            200
        );

        assert.equal(
            res.body.provenance
                .schemaVersion,
            'financial-document-v2'
        );

        assert.equal(
            res.body.provenance
                .promptVersion,
            'whole-page-v2'
        );
    }
);
test('handler maps upstream limit without leaking error bodies',async()=>{const res=response();await createHandler({clientProvider:()=>({responses:{create:async()=>{throw Object.assign(new Error('secret image'),{status:429});}}}),rateLimit:()=>false})({method:'POST',body:request},res);assert.equal(res.code,429);assert.doesNotMatch(JSON.stringify(res.body),/secret/);});
test('handler aborts timed-out reads',async()=>{const res=response();const client={responses:{create:async(_, {signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'})),{once:true}))}};await createHandler({clientProvider:()=>client,timeoutMs:5,rateLimit:()=>false})({method:'POST',body:request},res);assert.equal(res.code,504);});
test(
    'new asset and liability semantic kinds are accepted',
    () => {
        const asset =
            page('12000');

        asset.sections[0]
            .groups[0]
            .items[0]
            .semanticKind =
                'asset_balance';

        assert.equal(
            validateDocument(asset),
            asset
        );

        const liability =
            page('285000');

        liability.sections[0]
            .groups[0]
            .items[0]
            .semanticKind =
                'liability_balance';

        assert.equal(
            validateDocument(
                liability
            ),
            liability
        );
    }
);

test(
    'invalid normalized regions are rejected',
    () => {
        const invalid =
            page('420');

        invalid.sections[0]
            .groups[0]
            .items[0]
            .amountRegion =
                {
                    x: 950,
                    y: 250,
                    width: 100,
                    height: 50
                };

        assert.throws(
            () =>
                validateDocument(
                    invalid
                )
        );
    }
);

test(
    'consensus uses median amount region',
    () => {
        const first =
            page('420');

        const second =
            page('420');

        const third =
            page('420');

        first.sections[0]
            .groups[0]
            .items[0]
            .amountRegion.x =
                600;

        second.sections[0]
            .groups[0]
            .items[0]
            .amountRegion.x =
                650;

        third.sections[0]
            .groups[0]
            .items[0]
            .amountRegion.x =
                700;

        const result =
            mergeAlignedPasses([
                first,
                second,
                third
            ]);

        assert.equal(
            result.document
                .sections[0]
                .groups[0]
                .items[0]
                .amountRegion.x,
            650
        );
    }
);
