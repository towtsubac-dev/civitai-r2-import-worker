const html = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Civitai → R2 テスト</title>
<style>body{font:16px system-ui,sans-serif;max-width:520px;margin:5vh auto;padding:20px;background:#111827;color:#f9fafb}main{background:#1f2937;padding:24px;border-radius:14px}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:8px;font:inherit}input{background:#fff;color:#111}button{background:#60a5fa;border:0;margin-top:20px;cursor:pointer}small{color:#d1d5db}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h2>Civitai → R2 テスト</h2><p>モデルURLまたはバージョンIDを指定して、GitHub ActionsでR2テストバケットに転送します。</p>
<form id="f"><label for="url">Civitai URL / バージョンID</label><input id="url" required placeholder="https://civitai.com/models/...?...modelVersionId=3228867">
<label for="pass">テスト画面用パスワード</label><input id="pass" type="password" required autocomplete="off">
<button id="submit">転送を開始</button></form><p><small>保存先: civitai-lora-test / imports/ （本番環境には保存しません）</small></p><pre id="result" role="status" aria-live="polite"></pre><button id="refresh" type="button" hidden>状況を更新</button><p id="details"></p><hr><h3>R2 保存済みファイル</h3><button id="filesBtn" type="button">一覧を更新</button><p><small>テストバケット内の最大100件を表示（読み取り専用）</small></p><select id="files" size="6" style="width:100%;background:#fff;color:#111" aria-label="保存済みファイル"></select><pre id="fileDetails" role="status"></pre></main>
<script>
const form=document.querySelector('#f'),out=document.querySelector('#result'),btn=document.querySelector('#submit'),refresh=document.querySelector('#refresh'),details=document.querySelector('#details');let requestId=null,poll=null,pollCount=0;
function versionId(input){const s=input.trim();if(/^[0-9]+$/.test(s))return s;let u;try{u=new URL(s)}catch{throw Error('URLまたはバージョンIDを入力してください')}if(u.protocol!=='https:'||u.hostname!=='civitai.com')throw Error('civitai.com のURLを入力してください');const id=u.searchParams.get('modelVersionId');if(!id||!/^[0-9]+$/.test(id))throw Error('URLに modelVersionId がありません。バージョンIDを直接入力してください');return id}
async function checkStatus(){if(!requestId)return;try{const r=await fetch('/ui/status?id='+encodeURIComponent(requestId),{headers:{'X-Import-Password':document.querySelector('#pass').value}});const j=await r.json();if(!r.ok)throw Error(j.error||'状況を取得できません');const names={queued:'開始待ち',in_progress:'転送中',completed:'完了'};const conclusions={success:'成功',failure:'失敗',cancelled:'キャンセル',timed_out:'タイムアウト'};out.textContent='転送状況: '+(j.conclusion?(conclusions[j.conclusion]||j.conclusion):(names[j.status]||j.status));details.textContent=j.url?'実行結果: '+j.url:'';if(j.status==='queued'&&++pollCount>=60){clearInterval(poll);poll=null;out.textContent='実行履歴を確認できません。GitHub Actions画面で確認してください。'}if(j.status==='completed'){clearInterval(poll);poll=null;if(j.conclusion==='success')await loadFiles()}}catch(err){out.textContent='状況確認エラー: '+err.message}}const filesBtn=document.querySelector('#filesBtn'),files=document.querySelector('#files'),fileDetails=document.querySelector('#fileDetails');let savedFiles=[];
async function loadFiles(){filesBtn.disabled=true;fileDetails.textContent='一覧を取得しています…';try{const r=await fetch('/ui/files',{headers:{'X-Import-Password':document.querySelector('#pass').value}});const j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');savedFiles=j.files||[];files.replaceChildren();for(const f of savedFiles){const o=document.createElement('option');o.value=f.key;o.textContent=f.key;files.appendChild(o)}fileDetails.textContent=savedFiles.length+' 件表示'+(j.truncated?'（続きがあります）':'');if(savedFiles.length){files.selectedIndex=0;showFile()}}catch(e){fileDetails.textContent='一覧取得エラー: '+e.message}finally{filesBtn.disabled=false}}
function showFile(){const f=savedFiles.find(x=>x.key===files.value);if(f)fileDetails.textContent='保存先: '+f.key+'\\n容量: '+(f.size/1048576).toFixed(2)+' MiB\\n更新: '+f.uploaded}
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
  if(path!=="/ui/dispatch"&&path!=="/ui/status")return respond({error:"Not found"},404);
  if(!env.UI_IMPORT_PASSWORD||!env.GITHUB_DISPATCH_TOKEN)return respond({error:"UI dispatch not configured"},503);
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
