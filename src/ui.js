const html = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Civitai → R2 テスト</title>
<style>body{font:16px system-ui,sans-serif;max-width:520px;margin:5vh auto;padding:20px;background:#111827;color:#f9fafb}main{background:#1f2937;padding:24px;border-radius:14px}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:8px;font:inherit}input{background:#fff;color:#111}button{background:#60a5fa;border:0;margin-top:20px;cursor:pointer}small{color:#d1d5db}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h2>Civitai → R2 テスト</h2><p>モデルURLまたはバージョンIDを指定して、GitHub ActionsでR2テストバケットに転送します。</p>
<form id="f"><label for="url">Civitai URL / バージョンID</label><input id="url" required placeholder="https://civitai.com/models/...?...modelVersionId=3228867">
<label for="pass">テスト画面用パスワード</label><input id="pass" type="password" required autocomplete="off">
<button id="submit">転送を開始</button></form><p><small>保存先: civitai-lora-test / imports/ （本番環境には保存しません）</small></p><pre id="result" role="status" aria-live="polite"></pre></main>
<script>
const form=document.querySelector('#f'),out=document.querySelector('#result'),btn=document.querySelector('#submit');
function versionId(input){const s=input.trim();if(/^\\d+$/.test(s))return s;let u;try{u=new URL(s)}catch{throw Error('URLまたはバージョンIDを入力してください')}if(u.protocol!=='https:'||u.hostname!=='civitai.com')throw Error('civitai.com のURLを入力してください');const id=u.searchParams.get('modelVersionId');if(!id||!/^\\d+$/.test(id))throw Error('URLに modelVersionId がありません。バージョンIDを直接入力してください');return id}
form.addEventListener('submit',async e=>{e.preventDefault();btn.disabled=true;out.textContent='開始しています…';try{const id=versionId(document.querySelector('#url').value);const password=document.querySelector('#pass').value;const r=await fetch('/ui/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelVersionId:id,password})});const j=await r.json();if(!r.ok)throw Error(j.error||'開始できませんでした');out.textContent='GitHub Actionsに開始要求を送信しました。\\n'+j.actions_url+'\\n実行結果はActions画面で確認してください。'}catch(err){out.textContent='エラー: '+err.message}finally{btn.disabled=false}});
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
  if(path!=="/ui/dispatch"||request.method!=="POST")return respond({error:"Not found"},404);
  if(!env.UI_IMPORT_PASSWORD||!env.GITHUB_DISPATCH_TOKEN)return respond({error:"UI dispatch not configured"},503);
  const raw=await request.text();
  if(raw.length>2048)return respond({error:"Request too large"},413);
  let payload;try{payload=JSON.parse(raw)}catch{return respond({error:"Invalid JSON"},400)}
  const id=String(payload.modelVersionId||"");
  if(!/^[1-9][0-9]{0,14}$/.test(id))return respond({error:"Invalid version ID"},400);
  if(typeof payload.password!=="string"||!(await matches(payload.password,env.UI_IMPORT_PASSWORD)))return respond({error:"Unauthorized"},401);
  const github=await fetch("https://api.github.com/repos/towtsubac-dev/civitai-r2-import-worker/actions/workflows/direct-r2-import.yml/dispatches",{
    method:"POST",headers:{"Authorization":"Bearer "+env.GITHUB_DISPATCH_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"civitai-r2-import-preview"},
    body:JSON.stringify({ref:"main",inputs:{model_version_id:id}})
  });
  if(github.status!==204)return respond({error:"GitHub workflow dispatch failed ("+github.status+")"},502);
  return respond({status:"queued",actions_url:"https://github.com/towtsubac-dev/civitai-r2-import-worker/actions/workflows/direct-r2-import.yml"},202);
}
