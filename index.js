import express from "express";
import fetch from "node-fetch";
import { URL } from "url";
import http from "http";
import WebSocket, { WebSocketServer } from "ws"; // ws package

const app = express();
const proxyBase = "https://onix-server-official.onrender.com";

// npm i express node-fetch url http ws

// Node-side function
function rewriteScriptSrc(html, baseUrl, proxyBase) {
  const regex = /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi;

  return html.replace(regex, function(match, before, quote, src, after) {
    let proxied;
    try {
      proxied = proxify(src, baseUrl, proxyBase);
    } catch {
      proxied = src;
    }
    return '<script' + before + ' src=' + quote + proxied + quote + after + '>';
  });
}

// browser-side code inside injectBase should NOT contain this function
function injectBase(html) {
  const injection = `
<script>
const PROXY_BASE = "${proxyBase}";

(() => {
  // grab original target once
  const REAL_BASE = new URLSearchParams(window.location.search).get("url");
  if (!REAL_BASE) return;

  // Clicks
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const url = new URL(a.href, REAL_BASE);
    window.location.href = PROXY_BASE + "/?url=" + encodeURIComponent(url.href);
    e.preventDefault();
  });

  // Forms
  document.addEventListener("submit", e => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    e.preventDefault();

    const actionUrl = form.action || REAL_BASE;
    const abs = new URL(actionUrl, REAL_BASE).href;

    let finalUrl = abs;

    if ((form.method || "GET").toUpperCase() === "GET") {
      const formData = new FormData(form);
      const params = new URLSearchParams(formData).toString();
      if (params) {
        finalUrl = form.action + "?" + new URLSearchParams(formData).toString()
      }
    }

    // Use the ORIGINAL REAL_BASE, never re-read window.location.search
    window.location.href = finalUrl
  });
})();
</script>
`;
  // Inject before </head> or after <head>
  if (/<base\s+href=/i.test(html)) {
    return html.replace(/<base\s+href=["'][^"']*["']\s*\/?>/i, injection);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
}






function rewriteWindowLocation(html, proxyBase, baseUrl) {
    return html.replace(
        /window\.location\.href\s*=\s*(['"])(.*?)\1/gi,
        (match, quote, url) => {
            try {
                const abs = new URL(url, baseUrl).href;
                if (abs.startsWith(proxyBase)) return match;
                return `window.location.href=${quote}${proxyBase}?url=${encodeURIComponent(abs)}${quote}`;
            } catch {
                return match;
            }
        }
    );
}

function getRealBase() {
  const params = new URLSearchParams(window.location.search);
  return params.get("url") || window.location.href;
}




function proxify(link, baseUrl, proxyBase) {
  try {
    const abs = new URL(link, baseUrl).href;
    if (abs.startsWith(proxyBase)) return abs; // already proxied
    const host = new URL(abs).host;
    if (host === proxyBase) return abs;   // skip local redirects
    return proxyBase + "?url=" + encodeURIComponent(abs);
  } catch {
    return link;
  }
}




function rewriteUrls(html, baseUrl, proxyBase) {
  return html.replace(
    /(<script[\s\S]*?<\/script>)|(<style[\s\S]*?<\/style>)|([\s\S]*?)(?=<script|<style|$)/gi,
    (match, script, style, chunk) => {
      if (script || style) return match;

      return chunk
        .replace(/\b(href|src|action|data-src)=(["'])([^"'#]+)\2/gi,
  (m, attr, quote, link) =>
    `${attr}=${quote}${proxify(link, baseUrl, proxyBase)}${quote}`
)

        .replace(/url\(([^)]+)\)/gi,
          (_, link) => `url("${proxify(link.replace(/['"]/g, ""), baseUrl, proxyBase)}")`);
    }
  );
}


const server = http.createServer(app);

// 🚫 WebSocket deprecation handler
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        // send deprecation message then close
        ws.send(`
        <!DOCTYPE html>
        <html>
        <head>
        <style>
            body {
                text-align: center;
                font-family: sans-serif;
                background-color: #f4f4f4;
                padding-top: 50px;
            }

            /* Entry animation for the whole page */
            .container {
                animation: appear 0.6s ease forwards;
            }

            @keyframes appear {
                0% { opacity: 0; filter: blur(10px); transform: scale(0.9); }
                100% { opacity: 1; filter: blur(0); transform: scale(1); }
            }

            /* The Countdown Logic */
            .countdown::after {
                content: "5 seconds"; /* Initial state */
                animation: timer 5s steps(1) forwards;
                font-weight: bold;
            }

            @keyframes timer {
                0%   { content: "5 seconds"; }
                20%  { content: "4 seconds"; }
                40%  { content: "3 seconds"; }
                60%  { content: "2 seconds"; }
                80%  { content: "1 second"; }
                100% { content: "0 seconds"; }
            }
        </style>
        </head>
        <body>

        <div class="container">
            <h1>Onix</h1>
            <hr style="width:50%;" />
            <p>Onix Secure Browser's Fetch WebSocket is deprecated.<br/>
            Please use the website.</p>
            
            <div class="countdown">You will be disconnected in </div>
        </div>
        `);
        setTimeout(() => {
            ws.close();
        }, 5000)
    });
});

app.get("/", async (req, res) => {
    const target = req.query.url;
    if (!target) return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
        <style>
            body {
                text-align: center;
                font-family: sans-serif;
                background-color: #f4f4f4;
                padding-top: 50px;
                margin: 0;
                display: flex;
                justify-content: center;
            }

            .container {
                max-width: 600px;
                /* added a 0.2s delay so the user sees the start of the animation */
                animation: appear 0.8s ease-out 0.2s both; 
            }

            @keyframes appear {
                0% { 
                    opacity: 0; 
                    filter: blur(15px); 
                    transform: scale(0.95) translateY(20px); 
                }
                100% { 
                    opacity: 1; 
                    filter: blur(0); 
                    transform: scale(1) translateY(0); 
                }
            }
            
            header {
                animation: appear 0.8s ease-out 0.2s both; 
                background-color: grey;
                position: fixed;
                width: 100%;
                bottom: 0px;
                left: 0px;
                align-items: center;
                padding: 10px;
                text-align: center;
            }
        </style>
        </head>
        <body>

        <div class="container">
            <h1>Onix</h1><h2>v1.0</h2>
            <hr />
            <p>
                Hello world!<br/><br/>
                This is <strong>Onix</strong>, AKA Onix Secure Browser, it's a proxy that lets you browse the internet without having to worry about your privacy. All the fetching is done on the proxy server!<br /><br/>
                In order to start browsing, either click <a href=${proxyBase}/?url=https://mojeek.com>here</a>, or add <code>?url=htps://example.com</code> after this URL.
            </p>
        </div>
        <header>
                If a page has redirected you here, this means that a website has tried redirecting you to a relative link, but the URL was tied to this proxy.
        </header>

        </body>
        </html>
        `);

    if (!target.startsWith("http://") && !target.startsWith("https://")) {
        return res.status(400).send("invalid protocol");
    }

    try {
        const response = await fetch(target, { headers: { "User-Agent": "output" } });
        let body = await response.text();
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("text/html")) {
  body = rewriteScriptSrc(body, target, proxyBase);
body = rewriteUrls(body, target, proxyBase);
body = rewriteWindowLocation(body, proxyBase, target);
if (contentType.includes("text/html")) {
  body = injectBase(body, target); // nothing else
}


}


        res.set("Content-Type", contentType);
        res.send(body);
    } catch (e) {
        res.status(500).send("fetch failed: " + e.message);
    }
});

server.listen(3000, () => {
    console.log("🧠 Onix recursive HTTP proxy online");
});

