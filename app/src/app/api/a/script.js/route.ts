import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Einbett-Skript für externe Websites (z. B. onelog.pro):
//   <script defer src="https://<crm>/api/a/script.js?ws=onelog"></script>
// Ohne Cookies, ohne localStorage. Conversions: window.pdTrack("newsletter").

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("ws") ?? "";
  const ws = /^[a-z0-9-]{1,60}$/.test(slug) ? await db.workspace.findUnique({ where: { slug }, select: { slug: true } }) : null;
  if (!ws) return new Response("/* unbekannter Sub-Account */", { status: 404, headers: { "content-type": "application/javascript; charset=utf-8" } });

  const endpoint = `${new URL(env.appUrl()).origin}/api/a/collect`;
  const js = `(function(){"use strict";try{
var E=${JSON.stringify(endpoint)},W=${JSON.stringify(ws.slug)},first=true,last=null;
function send(k,n){try{var b=JSON.stringify({ws:W,k:k,n:n||undefined,u:location.href,r:first?(document.referrer||undefined):undefined});first=false;
if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([b],{type:"text/plain"})))return;
fetch(E,{method:"POST",body:b,headers:{"content-type":"text/plain"},keepalive:true,credentials:"omit",mode:"cors"}).catch(function(){});}catch(e){}}
function pv(){if(location.href===last)return;last=location.href;send("pageview");}
var p=history.pushState;history.pushState=function(){var r=p.apply(this,arguments);setTimeout(pv,0);return r;};
addEventListener("popstate",pv);
window.pdTrack=function(name){send("event",String(name||"conversion").slice(0,120));};
if(document.visibilityState==="prerender"){document.addEventListener("visibilitychange",function v(){if(document.visibilityState!=="prerender"){document.removeEventListener("visibilitychange",v);pv();}});}else{pv();}
}catch(e){}})();`;

  return new Response(js, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
