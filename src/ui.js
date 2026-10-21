const html = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Civitai → R2 テスト</title>
<style>body{font:16px system-ui,sans-serif;max-width:520px;margin:5vh auto;padding:20px;background:#111827;color:#f9fafb}main{background:#1f2937;padding:24px;border-radius:14px}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:8px;font:inherit}input{background:#fff;color:#111}button{background:#60a5fa;border:0;margin-top:20px;cursor:pointer}small{color:#d1d5db}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h2>Civitai → R2 テスト</h2><p>モデルURLまたはバージョンIDを指定して、GitHub ActionsでR2テストバケットに転送します。</p>
<form id="f"><label for="url">Civitai URL / バージョンID</label><input id="url" required placeholder="https://civitai.com/models/...?...modelVersionId=3228867">
<label for="pass">テスト画面用パスワード</label><input id="pass" type="password" required autocomplete="off">
<button id="submit">転送を開始</button></form><p><small>保存先: civitai-lora-test / imports/ （本番環境には保存しません）</small></p><pre id="result" role="status" aria-live="polite"></pre><button id="refresh" type="button" hidden>状況を更新</button><p id="details"></p><hr><h3>R2 保存済みファイル</h3><button id="filesBtn" type="button">一覧を更新</button><p><small>テストバケット内の最大100件を表示</small></p><select id="files" size="6" style="width:100%;background:#fff;color:#111" aria-label="保存済みファイル"></select><pre id="fileDetails" role="status"></pre><button id="deleteBtn" type="button" style="background:#fca5a5;color:#111">選択したLoRAを削除</button><pre id="deleteResult" role="status"></pre><button id="promoteBtn" type="button" style="background:#86efac;color:#111">選択したLoRAを本番ライブラリに登録</button><pre id="promoteResult" role="status"></pre><label for="lookupVersion">既存ファイルのCivitaiバージョンID照合</label><input id="lookupVersion" inputmode="numeric" placeholder="例: 3203205"><button id="lookupBtn" type="button">モデル情報を照合（保存しない）</button><pre id="lookupResult" role="status"></pre><button id="inspectBtn" type="button">選択ファイルの内部構造を確認（読み取り専用）</button><pre id="inspectResult" role="status"></pre></main>
<script>
const form=document.querySelector('#f'),out=document.querySelector('#result'),btn=document.querySelector('#submit'),refresh=document.querySelector('#refresh'),details=document.querySelector('#details');let requestId=null,poll=null,pollCount=0;
function versionId(input){const s=input.trim();if(/^[0-9]+$/.test(s))return s;let u;try{u=new URL(s)}catch{throw Error('URLまたはバージョンIDを入力してください')}if(u.protocol!=='https:'||u.hostname!=='civitai.com')throw Error('civitai.com のURLを入力してください');const id=u.searchParams.get('modelVersionId');if(!id||!/^[0-9]+$/.test(id))throw Error('URLに modelVersionId がありません。バージョンIDを直接入力してください');return id}
async function checkStatus(){if(!requestId)return;try{const r=await fetch('/ui/status?id='+encodeURIComponent(requestId),{headers:{'X-Import-Password':document.querySelector('#pass').value}});const j=await r.json();if(!r.ok)throw Error(j.error||'状況を取得できません');const names={queued:'開始待ち',in_progress:'転送中',completed:'完了'};const conclusions={success:'成功',failure:'失敗',cancelled:'キャンセル',timed_out:'タイムアウト'};out.textContent='転送状況: '+(j.conclusion?(conclusions[j.conclusion]||j.conclusion):(names[j.status]||j.status));details.textContent=j.url?'実行結果: '+j.url:'';if(j.status==='queued'&&++pollCount>=60){clearInterval(poll);poll=null;out.textContent='実行履歴を確認できません。GitHub Actions画面で確認してください。'}if(j.status==='completed'){clearInterval(poll);poll=null;if(j.conclusion==='success')await loadFiles()}}catch(err){out.textContent='状況確認エラー: '+err.message}}const filesBtn=document.querySelector('#filesBtn'),files=document.querySelector('#files'),fileDetails=document.querySelector('#fileDetails'),deleteBtn=document.querySelector('#deleteBtn'),deleteResult=document.querySelector('#deleteResult');let savedFiles=[];
async function loadFiles(){filesBtn.disabled=true;fileDetails.textContent='一覧を取得しています…';try{const r=await fetch('/ui/files',{headers:{'X-Import-Password':document.querySelector('#pass').value}});const j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');savedFiles=j.files||[];files.replaceChildren();for(const f of savedFiles){const o=document.createElement('option');o.value=f.key;const name=f.meta['civitai-model-name'];const version=f.meta['civitai-version-name'];const id=f.meta['civitai-version-id'];o.textContent=name?(name+' / '+(version||'バージョン名なし')+' [ID '+(id||'?')+']'):'未識別のLoRA（以前の転送） / '+f.key;files.appendChild(o)}fileDetails.textContent=savedFiles.length+' 件表示'+(j.truncated?'（続きがあります）':'');if(savedFiles.length){files.selectedIndex=0;showFile()}}catch(e){fileDetails.textContent='一覧取得エラー: '+e.message}finally{filesBtn.disabled=false}}
function showFile(){const f=savedFiles.find(x=>x.key===files.value);if(f)fileDetails.textContent='保存先: '+f.key+'\\n容量: '+(f.size/1048576).toFixed(2)+' MiB\\n更新: '+f.uploaded+'\\nモデル名: '+(f.meta['civitai-model-name']||'記録なし（以前の転送）')+'\\nバージョンID: '+(f.meta['civitai-version-id']||'記録なし')+'\\nバージョン名: '+(f.meta['civitai-version-name']||'記録なし')+'\\n元ファイル名: '+(f.meta['civitai-filename']||'記録なし')+'\\nベースモデル: '+(f.meta['civitai-base-model']||'記録なし')+'\\nCivitai: '+(f.meta['civitai-version-id']?'https://civitai.com/api/v1/model-versions/'+f.meta['civitai-version-id']:'記録なし')}
deleteBtn.addEventListener('click',async()=>{const f=savedFiles.find(x=>x.key===files.value);if(!f){deleteResult.textContent='削除するファイルを選択してください';return}const label=(f.meta['civitai-model-name']||'未識別のLoRA')+' / '+(f.meta['civitai-version-name']||'バージョン名なし');if(!confirm('次のLoRAをR2から完全に削除します。\\n'+label+'\\n'+f.key+'\\n\\n削除後は元に戻せません。続行しますか？'))return;deleteBtn.disabled=true;deleteResult.textContent='削除中…';try{const r=await fetch('/ui/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Import-Password':document.querySelector('#pass').value},body:JSON.stringify({key:f.key})});const j=await r.json();if(!r.ok)throw Error(j.error||'削除失敗');deleteResult.textContent='削除完了: '+j.key;document.querySelector('#inspectResult').textContent='';lookupResult.textContent='';await loadFiles()}catch(e){deleteResult.textContent='削除エラー: '+e.message}finally{deleteBtn.disabled=false}});
document.querySelector('#promoteBtn').addEventListener('click',async()=>{const f=savedFiles.find(x=>x.key===files.value),out=document.querySelector('#promoteResult'),btn=document.querySelector('#promoteBtn');if(!f){out.textContent='ファイルを選択してください';return}const label=(f.meta['civitai-model-name']||'LoRA')+' / '+(f.meta['civitai-version-name']||'');if(!confirm(label+'\\n本番のMiniMax H3ライブラリへ登録しますか？'))return;btn.disabled=true;out.textContent='R2内でコピー・登録中…';try{const r=await fetch('/ui/promote',{method:'POST',headers:{'Content-Type':'application/json','X-Import-Password':document.querySelector('#pass').value},body:JSON.stringify({key:f.key})});const j=await r.json();if(!r.ok)throw Error(j.error||'登録失敗');out.textContent='本番ライブラリに登録完了: '+j.name+' (ID '+j.id+')\\n動画生成画面を再読み込みして確認してください';}catch(e){out.textContent='登録エラー: '+e.message}finally{btn.disabled=false}});
const lookupBtn=document.querySelector('#lookupBtn'),lookupResult=document.querySelector('#lookupResult');lookupBtn.addEventListener('click',async()=>{const f=savedFiles.find(x=>x.key===files.value),id=document.querySelector('#lookupVersion').value.trim();if(!f){lookupResult.textContent='先に保存済みファイルを選択してください';return}if(!/^[1-9][0-9]{0,14}$/.test(id)){lookupResult.textContent='正しいバージョンIDを入力してください';return}lookupBtn.disabled=true;lookupResult.textContent='Civitai情報を照合中…';try{const r=await fetch('/ui/lookup?id='+encodeURIComponent(id),{headers:{'X-Import-Password':document.querySelector('#pass').value}}),j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');const registeredId=f.meta['civitai-version-id'];const sameId=registeredId===id;const candidates=j.files.filter(x=>x.sizeKB>0);const sizes=candidates.map(x=>x.name+': 約'+(x.sizeKB/1024).toFixed(2)+' MiB').join(', ');lookupResult.textContent='Civitaiモデル: '+j.modelName+'\\nバージョン: '+j.versionName+' (ID '+id+')\\nベースモデル: '+j.baseModel+'\\nR2保存容量: '+(f.size/1048576).toFixed(2)+' MiB\\nCivitai公称容量: '+(sizes||'不明')+'\\n登録時のバージョンID: '+(registeredId||'記録なし')+'\\n判定: '+(sameId?'登録ID一致（転送時SHA-256検証済み）':registeredId?'登録ID不一致':'登録IDがなく判定不可')+'\\n※容量は参考値。現在の照合ではファイルの再ハッシュは実施していません';}catch(e){lookupResult.textContent='照合エラー: '+e.message}finally{lookupBtn.disabled=false}});files.addEventListener('change',()=>{lookupResult.textContent='';});
document.querySelector('#inspectBtn').addEventListener('click',async()=>{const key=files.value,out=document.querySelector('#inspectResult'),btn=document.querySelector('#inspectBtn');if(!key){out.textContent='先にファイルを選択してください';return}btn.disabled=true;out.textContent='ヘッダーを読み取り中…';try{const r=await fetch('/ui/inspect?key='+encodeURIComponent(key),{headers:{'X-Import-Password':document.querySelector('#pass').value}}),j=await r.json();if(!r.ok)throw Error(j.error||'読み取り失敗');out.textContent='テンソル数: '+j.tensorCount+'\\nキー例:\\n'+j.keySamples.join('\\n')+'\\nメタデータ:\\n'+JSON.stringify(j.metadata,null,2)+'\\nブロック別テンソル数: '+JSON.stringify(j.blockCounts||{})+'\\nup/down/alpha: '+j.up+'/'+j.down+'/'+j.alpha+'\\n形状例: '+JSON.stringify(j.shapeSamples||[],null,2)+'\\n不正なヘッダー項目: '+j.invalid+'\\n※モデル全体はダウンロードしていません'}catch(e){out.textContent='確認エラー: '+e.message}finally{btn.disabled=false}});
files.addEventListener('change',showFile);filesBtn.addEventListener('click',loadFiles);
refresh.addEventListener('click',checkStatus);
form.addEventListener('submit',async e=>{e.preventDefault();btn.disabled=true;out.textContent='開始しています…';try{const id=versionId(document.querySelector('#url').value);const password=document.querySelector('#pass').value;const r=await fetch('/ui/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelVersionId:id,password})});const j=await r.json();if(!r.ok)throw Error(j.error||'開始できませんでした');requestId=j.request_id;pollCount=0;refresh.hidden=false;details.textContent='';out.textContent='開始待ち';if(poll)clearInterval(poll);poll=setInterval(checkStatus,10000);await checkStatus()}catch(err){out.textContent='エラー: '+err.message}finally{btn.disabled=false}});
</script></html>`;

const respond = (data, status=200) => Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function matches(a,b) {
  const enc=new TextEncoder();
  const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
  const p=new Uint8Array(x),q=new Uint8Array(y);let diff=0;
  for(let i=0;i<p.length;i++)diff|=p[i]^q[i];
  return diff===0;
}
export async function handleUi(request,env,path){
  if(path==="/ui"&&request.method==="GET")
    return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  if(path!=="/ui/dispatch"&&path!=="/ui/status"&&path!=="/ui/files"&&path!=="/ui/lookup"&&path!=="/ui/inspect"&&path!=="/ui/delete"&&path!=="/ui/promote")return respond({error:"Not found"},404);
  if(!env.UI_IMPORT_PASSWORD||!env.GITHUB_DISPATCH_TOKEN)return respond({error:"UI dispatch not configured"},503);
  if(path==="/ui/promote") {
    if(request.method!=="POST")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    if(!env.LORA_BUCKET||!env.PRODUCTION_LORA_BUCKET)return respond({error:"R2 bindings not configured"},503);
    let payload;try{const raw=await request.text();if(raw.length>512)return respond({error:"Request too large"},413);payload=JSON.parse(raw)}catch{return respond({error:"Invalid JSON"},400)}
    const key=payload?.key;
    if(typeof key!=="string"||!/^imports\\/[0-9a-f-]{36}\\.safetensors$/.test(key))return respond({error:"Invalid key"},400);
    const source=await env.LORA_BUCKET.head(key);
    if(!source)return respond({error:"Source LoRA not found"},404);
    const m=source.customMetadata||{};
    const versionId=m["civitai-version-id"],fileName=m["civitai-filename"];
    if(!/^[1-9][0-9]{0,14}$/.test(versionId||"")||!fileName)return respond({error:"Civitai metadata missing"},422);
    if(source.size<16||source.size>512*1024*1024)return respond({error:"Invalid size"},422);
    try{
      const headers=env.CIVITAI_API_TOKEN?{Authorization:"Bearer "+env.CIVITAI_API_TOKEN}:{};
      const resp=await fetch("https://civitai.com/api/v1/model-versions/"+versionId,{headers});
      if(!resp.ok)return respond({error:"Civitai verification failed"},502);
      const version=await resp.json();
      const file=(version.files||[]).find(f=>f.name===fileName&&f.type==="Model");
      const sha=String(file?.hashes?.SHA256||"").toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(sha))return respond({error:"Source SHA-256 reference missing"},422);
      const name=((m["civitai-model-name"]||"LoRA")+" / "+(m["civitai-version-name"]||versionId)).slice(0,100);
      const id=crypto.randomUUID(), modelKey="loras/library/"+id+".safetensors",metaKey="loras/library/"+id+".json";
      const data=await env.LORA_BUCKET.get(key);
      if(!data||data.size!==source.size)return respond({error:"Source changed during copy"},409);
      try{
        await env.PRODUCTION_LORA_BUCKET.put(modelKey,data.body,{httpMetadata:{contentType:"application/octet-stream"}});
        const copied=await env.PRODUCTION_LORA_BUCKET.head(modelKey);
        if(!copied||copied.size!==source.size)throw Error("Copied size mismatch");
        const entry={id,name,size:source.size,sha256:sha,source:"civitai",created_at:new Date().toISOString(),compatible_models:["h3"]};
        await env.PRODUCTION_LORA_BUCKET.put(metaKey,JSON.stringify(entry),{httpMetadata:{contentType:"application/json"}});
        return respond({ok:true,id,name,size:source.size});
      }catch(e){await env.PRODUCTION_LORA_BUCKET.delete([metaKey,modelKey]).catch(()=>{});throw e}
    }catch(e){return respond({error:"R2 promotion failed: "+String(e.message||e).slice(0,120)},502)}
  }
  if(path==="/ui/delete") {
    if(request.method!=="POST")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    if(!env.LORA_BUCKET)return respond({error:"R2 binding not configured"},503);
    const raw=await request.text();
    if(raw.length>512)return respond({error:"Request too large"},413);
    let payload;try{payload=JSON.parse(raw)}catch{return respond({error:"Invalid JSON"},400)}
    const key=typeof payload.key==="string"?payload.key:"";
    if(!key.startsWith("imports/")||!key.endsWith(".safetensors")||key.length!==56||!/^[a-f0-9-]+$/.test(key.slice(8,-12)))return respond({error:"Invalid R2 key"},400);
    try{
      const object=await env.LORA_BUCKET.head(key);
      if(!object)return respond({error:"File not found"},404);
      await env.LORA_BUCKET.delete(key);
      return respond({deleted:true,key});
    }catch{return respond({error:"R2 deletion failed"},502)}
  }
  if(path==="/ui/inspect") {
    if(request.method!=="GET")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    if(!env.LORA_BUCKET)return respond({error:"R2 binding not configured"},503);
    const key=new URL(request.url).searchParams.get("key")||"";
    if(!key.startsWith("imports/")||!/^imports\/[0-9a-f-]{36}\.safetensors$/.test(key))return respond({error:"Invalid R2 key"},400);
    try {
      const first=await env.LORA_BUCKET.get(key,{range:{offset:0,length:8}});
      if(!first)return respond({error:"File not found"},404);
      const prefix=new Uint8Array(await first.arrayBuffer());
      if(prefix.length!==8)return respond({error:"Invalid safetensors prefix"},422);
      const length=Number(new DataView(prefix.buffer).getBigUint64(0,true));
      if(!Number.isSafeInteger(length)||length<2||length>8*1024*1024)return respond({error:"Header exceeds 8 MiB limit or is invalid"},422);
      const part=await env.LORA_BUCKET.get(key,{range:{offset:8,length}});
      if(!part)return respond({error:"Header not found"},404);
      const bytes=await part.arrayBuffer();
      if(bytes.byteLength!==length)return respond({error:"Incomplete header"},422);
      const header=JSON.parse(new TextDecoder().decode(bytes));
      const keys=Object.keys(header).filter(k=>k!=="__metadata__");
      const meta=header.__metadata__||{};
      const safeMeta={};
      for(const [k,v] of Object.entries(meta).slice(0,15))safeMeta[String(k).slice(0,100)]=String(v).slice(0,300);
      const counts={};const shapes=[];let invalid=0;let up=0,down=0,alpha=0;
      for(const k of keys){
        const t=header[k];
        if(!t||!Array.isArray(t.shape)||!Array.isArray(t.data_offsets)){invalid++;continue}
        const group=k.match(/^lora_unet_blocks_([0-9]+)_/);
        if(group)counts[group[1]]=(counts[group[1]]||0)+1;
        if(k.endsWith(".lora_up.weight"))up++;
        if(k.endsWith(".lora_down.weight"))down++;
        if(k.endsWith(".alpha"))alpha++;
        if(shapes.length<25&&(k.endsWith(".lora_up.weight")||k.endsWith(".lora_down.weight")))shapes.push({key:k,shape:t.shape,dtype:t.dtype});
      }
      return respond({tensorCount:keys.length,keySamples:keys.slice(0,35),metadata:safeMeta,blockCounts:counts,up,down,alpha,invalid,shapeSamples:shapes});
    }catch{return respond({error:"Could not inspect safetensors header"},502)}
  }
  if(path==="/ui/lookup") {
    if(request.method!=="GET")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    const id=new URL(request.url).searchParams.get("id")||"";
    if(!/^[1-9][0-9]{0,14}$/.test(id))return respond({error:"Invalid version ID"},400);
    try {
      const headers=env.CIVITAI_API_TOKEN?{Authorization:"Bearer "+env.CIVITAI_API_TOKEN}:{};
      const r=await fetch("https://civitai.com/api/v1/model-versions/"+id,{headers});
      if(!r.ok)return respond({error:"Civitai metadata request failed ("+r.status+")"},502);
      const v=await r.json();
      return respond({modelName:v.model?.name||"不明",versionName:v.name||"不明",baseModel:v.baseModel||"不明",files:(v.files||[]).filter(f=>f.type==="Model"&&/\\.safetensors$/i.test(f.name||"")).map(f=>({name:f.name,sizeKB:Number(f.sizeKB)||0}))});
    }catch{return respond({error:"Civitai metadata lookup failed"},502)}
  }
  if(path==="/ui/files") {
    if(request.method!=="GET")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    if(!env.LORA_BUCKET)return respond({error:"R2 binding not configured"},503);
    try {
      const result=await env.LORA_BUCKET.list({prefix:"imports/",limit:100,include:["customMetadata"]});
      return respond({files:result.objects.filter(o=>o.key.endsWith(".safetensors")).map(o=>({key:o.key,size:o.size,uploaded:o.uploaded.toISOString(),meta:o.customMetadata||{}})),truncated:result.truncated});
    }catch{return respond({error:"R2 file listing failed"},502)}
  }
  if(path==="/ui/status") {
    if(request.method!=="GET")return respond({error:"Method not allowed"},405);
    if(!(await matches(request.headers.get("X-Import-Password")||"",env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
    const id=new URL(request.url).searchParams.get("id")||"";
    if(!/^[a-f0-9-]{36}$/.test(id))return respond({error:"Invalid request ID"},400);
    const response=await fetch("https://api.github.com/repos/towtsubac-dev/civitai-r2-import-worker/actions/workflows/direct-r2-import.yml/runs?event=workflow_dispatch&per_page=50",{
      headers:{"Authorization":"Bearer "+env.GITHUB_DISPATCH_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"civitai-r2-import-preview"}
    });
    if(!response.ok)return respond({error:"GitHub status lookup failed ("+response.status+")"},502);
    const data=await response.json();
    const run=(data.workflow_runs||[]).find(r=>(r.display_title||"").includes(id));
    if(!run)return respond({status:"queued",conclusion:null,url:null});
    return respond({status:run.status,conclusion:run.conclusion||null,url:run.html_url});
  }
  if(request.method!=="POST")return respond({error:"Method not allowed"},405);
  const raw=await request.text();
  if(raw.length>2048)return respond({error:"Request too large"},413);
  let payload;try{payload=JSON.parse(raw)}catch{return respond({error:"Invalid JSON"},400)}
  const id=String(payload.modelVersionId||"");
  if(!/^[1-9][0-9]{0,14}$/.test(id))return respond({error:"Invalid version ID"},400);
  if(typeof payload.password!=="string"||!(await matches(payload.password,env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
  const requestId=crypto.randomUUID();
  const github=await fetch("https://api.github.com/repos/towtsubac-dev/civitai-r2-import-worker/actions/workflows/direct-r2-import.yml/dispatches",{
    method:"POST",headers:{"Authorization":"Bearer "+env.GITHUB_DISPATCH_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"civitai-r2-import-preview"},
    body:JSON.stringify({ref:"main",inputs:{model_version_id:id,request_id:requestId}})
  });
  if(github.status!==204)return respond({error:"GitHub workflow dispatch failed ("+github.status+")"},502);
  return respond({status:"queued",request_id:requestId,actions_url:"https://github.com/towtsubac-dev/civitai-r2-import-worker/actions/workflows/direct-r2-import.yml"},202);
}
