// Script khung chat nhúng (chạy trên website của khách hàng). JavaScript thuần, không phụ thuộc thư viện, dựng trong shadow DOM để
// không đụng kiểu chữ của trang. Chỉ dùng textContent khi hiện tin (không chèn HTML) nên tin từ khách hay từ nhân viên không chạy được mã.
// Chỉ lưu mã phiên của chính nó trong localStorage; không đọc cookie hay dữ liệu của trang chủ.
// Nếu trang đặt window.KPS_CHAT = { name, shop, lang, position?, bottom? } (như KP Shop) thì dùng làm tên khung chat, ngôn ngữ và vị trí.
export function widgetScript(base: string, key: string): string {
  return `(function(){
var ID="__kpchat_${key.slice(0, 8)}";if(window[ID])return;window[ID]=1;
var BASE=${JSON.stringify(base.replace(/\/$/, ""))},KEY=${JSON.stringify(key)},SK="kpchat_sid_"+KEY;
var K=(window.KPS_CHAT&&typeof window.KPS_CHAT==="object")?window.KPS_CHAT:{};
var LANGS=["vi","en","ko","zh","ru"],lang=String(K.lang||"").toLowerCase().slice(0,2);if(LANGS.indexOf(lang)<0)lang="vi";
var T={vi:{ph:"Nhập tin nhắn...",send:"Gửi",close:"Đóng",open:"Mở khung chat",bot:"Trợ lý tự động",agent:"Nhân viên",hello:"Xin chào! Mình có thể giúp gì cho bạn?",err:"Không gửi được",net:"Mất kết nối, thử lại sau",att:"Đính kèm ảnh",ho:"Nhân viên sẽ trả lời bạn sớm nhất có thể.",rm:"Bỏ ảnh",big:"Ảnh lớn quá (tối đa 5MB)",typ:"Chỉ gửi ảnh jpg, png hoặc webp"},
en:{ph:"Type a message...",send:"Send",close:"Close",open:"Open chat",bot:"Automated assistant",agent:"Staff",hello:"Hello! How can I help you?",err:"Could not send",net:"Connection lost, please try again",att:"Attach a photo",ho:"A staff member will reply as soon as possible.",rm:"Remove photo",big:"Photo is too large (max 5MB)",typ:"Only jpg, png or webp photos"},
ko:{ph:"메시지를 입력하세요...",send:"보내기",close:"닫기",open:"채팅 열기",bot:"자동 도우미",agent:"직원",hello:"안녕하세요! 무엇을 도와드릴까요?",err:"전송하지 못했습니다",net:"연결이 끊겼습니다. 다시 시도해 주세요",att:"사진 첨부",ho:"직원이 최대한 빨리 답변드리겠습니다.",rm:"사진 삭제",big:"사진이 너무 큽니다 (최대 5MB)",typ:"jpg, png, webp 사진만 보낼 수 있습니다"},
zh:{ph:"请输入消息...",send:"发送",close:"关闭",open:"打开聊天",bot:"自动助手",agent:"工作人员",hello:"您好！有什么可以帮您？",err:"发送失败",net:"连接中断，请稍后重试",att:"添加图片",ho:"工作人员会尽快回复您。",rm:"移除图片",big:"图片太大（最大 5MB）",typ:"仅支持 jpg、png、webp 图片"},
ru:{ph:"Введите сообщение...",send:"Отправить",close:"Закрыть",open:"Открыть чат",bot:"Автоматический помощник",agent:"Сотрудник",hello:"Здравствуйте! Чем могу помочь?",err:"Не удалось отправить",net:"Нет соединения, попробуйте позже",att:"Прикрепить фото",ho:"Сотрудник ответит вам как можно скорее.",rm:"Убрать фото",big:"Фото слишком большое (макс. 5 МБ)",typ:"Только фото jpg, png или webp"}}[lang];
var sid="";try{sid=localStorage.getItem(SK)||""}catch(e){}
var cfg={title:"Chat",greeting:"",color:"#1E3A8A",position:"right"},ho=false,open=false,last=0,seen={},unread=0,pollT=null,msgs=[];
function post(p,b){return fetch(BASE+p,{method:"POST",body:JSON.stringify(b),headers:{"content-type":"text/plain"}}).then(function(r){return r.json()})}
function get(p){return fetch(BASE+p).then(function(r){return r.json()})}
var host=document.createElement("div");
var root=host.attachShadow?host.attachShadow({mode:"open"}):host;
var css=document.createElement("style");
css.textContent=".fab{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;position:relative}.fab svg{width:28px;height:28px}.badge{position:absolute;top:-4px;right:-4px;background:#DC2626;color:#fff;border-radius:99px;font-size:11px;font-weight:700;min-width:18px;height:18px;display:none;align-items:center;justify-content:center;padding:0 4px}.panel{display:none;flex-direction:column;width:340px;max-width:calc(100vw - 24px);height:480px;max-height:calc(100vh - 100px);max-height:calc(100dvh - 100px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;margin-bottom:12px}.hd{display:flex;align-items:center;gap:8px;padding:14px 16px;color:#fff;font-weight:700;font-size:15px}.hd span{flex:1}.hd button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}.ms{flex:1;overflow-y:auto;padding:12px;background:#F6F7FB;display:flex;flex-direction:column;gap:8px}.b{max-width:82%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;color:#14141F;background:#fff;border:1px solid #E5E7EB;align-self:flex-start}.b.v{align-self:flex-end;color:#fff;border:0}.b small{display:block;font-size:10.5px;opacity:.65;margin-bottom:2px}.b img{max-width:100%;max-height:260px;border-radius:8px;display:block;margin-top:4px;cursor:pointer}.err{font-size:12px;color:#B91C1C;text-align:center}.hn{font-size:12px;color:#92400E;background:#FEF3C7;border-radius:10px;padding:6px 10px;text-align:center}form{display:flex;gap:8px;padding:10px;border-top:1px solid #E5E7EB;background:#fff}input{flex:1;min-width:0;border:1px solid #D1D5DB;border-radius:99px;padding:9px 14px;font-size:16px;outline:none}input:focus{border-color:#6B7280}form button{border:0;border-radius:99px;color:#fff;padding:0 16px;font-weight:700;cursor:pointer}.katt{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:#F3F4F6;color:#4B5563;cursor:pointer;display:flex;align-items:center;justify-content:center;align-self:center}.katt svg{width:20px;height:20px}.pv{display:none;padding:8px 10px 0;background:#fff;border-top:1px solid #E5E7EB}.pv.on{display:block}.pv.on+form{border-top:0}.pv div{position:relative;display:inline-block}.pv img{height:64px;max-width:120px;object-fit:cover;border-radius:8px;display:block;border:1px solid #E5E7EB}.pv button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#111827;color:#fff;font-size:14px;line-height:1;cursor:pointer;padding:0}.wrap{display:flex;flex-direction:column}";
root.appendChild(css);
var wrap=document.createElement("div");wrap.className="wrap";
var panel=document.createElement("div");panel.className="panel";
var hd=document.createElement("div");hd.className="hd";var ht=document.createElement("span");var hx=document.createElement("button");hx.textContent="\\u00d7";hx.setAttribute("aria-label",T.close);hd.appendChild(ht);hd.appendChild(hx);
var ms=document.createElement("div");ms.className="ms";
var form=document.createElement("form");var inp=document.createElement("input");inp.maxLength=1000;inp.placeholder=T.ph;var sb=document.createElement("button");sb.type="submit";sb.textContent=T.send;var at=document.createElement("button");at.type="button";at.className="katt";at.setAttribute("aria-label",T.att);at.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
var fi=document.createElement("input");fi.type="file";fi.accept="image/jpeg,image/png,image/webp";fi.style.display="none";
var pv=document.createElement("div");pv.className="pv";
form.appendChild(inp);form.appendChild(at);form.appendChild(sb);
panel.appendChild(hd);panel.appendChild(ms);panel.appendChild(pv);panel.appendChild(form);panel.appendChild(fi);
var fab=document.createElement("button");fab.className="fab";fab.setAttribute("aria-label",T.open);fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
var badge=document.createElement("span");badge.className="badge";fab.appendChild(badge);
wrap.appendChild(panel);wrap.appendChild(fab);root.appendChild(wrap);
function place(){var pos=(K.position==="left"||K.position==="right")?K.position:cfg.position;var b=Number(K.bottom);if(!(b>=0&&b<=600))b=20;
host.style.cssText="position:fixed;bottom:"+b+"px;"+(pos==="left"?"left":"right")+":20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";wrap.style.alignItems=pos==="left"?"flex-start":"flex-end"}
function paint(){var n=(typeof K.name==="string"&&K.name.trim())?K.name.trim().slice(0,60):cfg.title;ht.textContent=n;hd.style.background=cfg.color;fab.style.background=cfg.color;sb.style.background=cfg.color;place()}
function bubble(m){var d=document.createElement("div");d.className="b"+(m.from==="visitor"?" v":"");if(m.from==="visitor")d.style.background=cfg.color;
if(m.from!=="visitor"){var s=document.createElement("small");s.textContent=m.from==="bot"?T.bot:T.agent;d.appendChild(s)}
if(m.text)d.appendChild(document.createTextNode(m.text));
(m.images||[]).forEach(function(u){if(/^https?:\\/\\//.test(u)){var i=document.createElement("img");i.src=u;i.alt="";i.onclick=function(){window.open(u,"_blank","noopener")};d.appendChild(i)}});return d}
function greet(){return lang==="vi"?cfg.greeting:T.hello}
function render(){ms.textContent="";var g0=greet();if(!msgs.length&&g0){var g=document.createElement("div");g.className="b";g.textContent=g0;ms.appendChild(g)}
msgs.forEach(function(m){ms.appendChild(bubble(m))});if(ho){var n=document.createElement("div");n.className="hn";n.textContent=T.ho;ms.appendChild(n)}ms.scrollTop=ms.scrollHeight}
function setHo(v){v=!!v;if(v!==ho){ho=v;render()}}
function add(list,fromPoll){var fresh=0;list.forEach(function(m){if(seen[m.id])return;seen[m.id]=1;msgs.push(m);if(m.at>last)last=m.at;if(m.from!=="visitor")fresh++});
if(list.length)render();if(fromPoll&&fresh&&!open){unread+=fresh;badge.textContent=unread>9?"9+":unread;badge.style.display="flex"}}
function poll(){if(!sid)return;get("/api/web/messages?key="+KEY+"&sid="+encodeURIComponent(sid)+"&after="+last).then(function(r){if(r&&r.ok){add(r.messages||[],true);setHo(r.handoff)}}).catch(function(){})}
function schedule(){clearInterval(pollT);pollT=setInterval(poll,open?3000:30000)}
function setOpen(v){open=v;panel.style.display=v?"flex":"none";fab.style.display=v?"none":"flex";if(v){unread=0;badge.style.display="none";render();inp.focus();poll()}schedule()}
fab.onclick=function(){setOpen(true)};hx.onclick=function(){setOpen(false)};
function showErr(t){var d=document.createElement("div");d.className="err";d.textContent=t;ms.appendChild(d);ms.scrollTop=ms.scrollHeight}
function clearErr(){var old=ms.querySelector(".err");if(old)old.remove()}
function fail(m){var e=new Error(m);e.kp=1;return e}
var pend=null,busy=false,TYPES=["image/jpeg","image/png","image/webp"];
function clearPend(){if(pend){URL.revokeObjectURL(pend.u);pend=null}pv.textContent="";pv.className="pv"}
function showPend(b){clearPend();var u=URL.createObjectURL(b);pend={b:b,u:u};var w=document.createElement("div"),im=document.createElement("img"),x=document.createElement("button");im.src=u;im.alt="";x.type="button";x.textContent="\\u00d7";x.setAttribute("aria-label",T.rm);x.onclick=clearPend;w.appendChild(im);w.appendChild(x);pv.appendChild(w);pv.className="pv on"}
function shrink(f){return new Promise(function(ok){if(f.size<=900000){ok(f);return}var u=URL.createObjectURL(f),im=new Image();
im.onload=function(){URL.revokeObjectURL(u);try{var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,1600/Math.max(w,h)),c=document.createElement("canvas");c.width=Math.round(w*k);c.height=Math.round(h*k);var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);c.toBlob(function(b){ok(b&&b.size<f.size?b:f)},"image/jpeg",.85)}catch(e){ok(f)}};
im.onerror=function(){URL.revokeObjectURL(u);ok(f)};im.src=u})}
function upload(b){var fd=new FormData();fd.append("key",KEY);fd.append("sid",sid);fd.append("file",b,b.type==="image/png"?"a.png":b.type==="image/webp"?"a.webp":"a.jpg");
return fetch(BASE+"/api/web/upload",{method:"POST",body:fd}).catch(function(){throw fail(T.net)}).then(function(r){return r.json()}).then(function(r){if(r&&r.ok)return r.url;throw fail((r&&r.error)||T.err)})}
at.onclick=function(){fi.click()};
fi.onchange=function(){var f=fi.files&&fi.files[0];fi.value="";if(!f)return;clearErr();if(TYPES.indexOf(f.type)<0){showErr(T.typ);return}shrink(f).then(function(b){if(b.size>5242880){showErr(T.big);return}showPend(b)})};
form.onsubmit=function(e){e.preventDefault();if(busy)return;var t=inp.value.trim(),p=pend;if(!(t||p)||!sid)return;clearErr();busy=true;sb.disabled=true;at.disabled=true;
(p?upload(p.b):Promise.resolve(null)).then(function(url){return post("/api/web/send",{key:KEY,sid:sid,text:t,lang:lang,images:url?[url]:[]})}).then(function(r){if(r&&r.ok){inp.value="";clearPend();add([r.message],false)}else{showErr((r&&r.error)||T.err)}}).catch(function(e){showErr(e&&e.kp?e.message:T.net)}).then(function(){busy=false;sb.disabled=false;at.disabled=false})};
post("/api/web/session",{key:KEY,sid:sid}).then(function(r){if(!r||!r.ok)return;sid=r.sid;try{localStorage.setItem(SK,sid)}catch(e){}cfg=r.config||cfg;ho=!!r.handoff;paint();add(r.messages||[],false);render();document.body.appendChild(host);schedule()}).catch(function(){});
})();`;
}
