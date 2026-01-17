import express from "express";
import fetch from "node-fetch";
import { URL } from "url";
import http from "http";
import WebSocket, { WebSocketServer } from "ws"; // ws package

const app = express();
const proxyBase = "http://127.0.0.1:3000";

// npm i express node-fetch url http ws

// Node-side function
function rewriteScriptSrc(html, baseUrl, proxyBase, enhance) {
  const regex = /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi;

  return html.replace(regex, function(match, before, quote, src, after) {
    let proxied;
    try {
      proxied = proxify(src, baseUrl, proxyBase, enhance); // pass enhance here
    } catch {
      proxied = src;
    }
    return '<script' + before + ' src=' + quote + proxied + quote + after + '>';
  });
}





// browser-side code inside injectBase should NOT contain this function
function injectBase(html, enhancer) {
  console.log(`BaseInjector: "${enhancer}"`)
  const injection = `
  ${enhancer == undefined ? `
  <style>

            *{
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
        </style>
    ` : ""}
<script>
(() => {
  const PROXY_BASE = "${proxyBase}";
  const urlParams = new URLSearchParams(window.location.search);
  const REAL_BASE = urlParams.get("url");
  const ENHANCE = urlParams.get("enhance"); // <-- grab it

  if (!REAL_BASE) return;

  function buildProxyUrl(target) {
    var proxied = PROXY_BASE + "/?url=" + encodeURIComponent(target);
    return ENHANCE ? proxied + "&enhance=" + encodeURIComponent(ENHANCE) : proxied;
  }



  // -------------------------------
  // Runtime URL proxifier
  // -------------------------------
  function proxifyRuntime(href) {
    if (!href) return href;

    // ⚡ skip if already proxied
    if (href.startsWith(PROXY_BASE)) return href;

    try {
      const resolved = new URL(href, REAL_BASE).href;
      return buildProxyUrl(resolved); // ✅ include enhance
    } catch (e) {
      return buildProxyUrl(
        REAL_BASE.replace(/\\/$/, "") + "/" + href.replace(/^\\/+/, "")
      );
    }
  }



  // -------------------------------
  // Override element.setAttribute
  // -------------------------------
  const _setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (["src","href","action","data","poster"].includes(name)) {
      value = proxifyRuntime(value);
    }
    return _setAttribute.call(this, name, value);
  };

  // -------------------------------
  // Override fetch
  // -------------------------------
  const _fetch = window.fetch;
  window.fetch = (input, init) => {
    try { input = proxifyRuntime(input); } catch {}
    return _fetch(input, init);
  };

  // -------------------------------
  // Override XHR
  // -------------------------------
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try { url = proxifyRuntime(url); } catch {}
    return _open.call(this, method, url, ...rest);
  };

  // -------------------------------
  // Override Worker
  // -------------------------------
  const _Worker = window.Worker;
  window.Worker = function(src, opts) {
    return new _Worker(proxifyRuntime(src), opts);
  };

  // -------------------------------
  // Intercept clicks on links
  // -------------------------------
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const url = new URL(a.href, REAL_BASE);
    window.location.href = buildProxyUrl(url.href);
    e.preventDefault();
  });


  // -------------------------------
  // Intercept form submits
  // -------------------------------
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
        finalUrl = "${proxyBase}" + "${enhancer == undefined ? "/?url=" : "/?enhance=stop&url="}" + new URLSearchParams(new URL(form.action).search).get("url") + encodeURIComponent("?" + new URLSearchParams(formData).toString())
      }
    }

    // Use the ORIGINAL REAL_BASE, never re-read window.location.search
    window.location.href = finalUrl
  });

})();
</script>
`;

  // Inject before <base> if present, otherwise after <head>
  if (/<base\s+href=/i.test(html)) {
    return html.replace(/<base\s+href=["'][^"']*["']\s*\/?>/i, injection);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
}




function rewriteJSUrls(html, baseUrl, proxyBase) {
    return html.replace(
        /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
        (full, js) => {
            const rewritten = js.replace(
                /(['"`])((?:https?:\/\/|\/)[^'"`\s]+)\1/g,
                (m, quote, url) => {
                    try {
                        // skip already proxied
                        if (url.startsWith(proxyBase)) return m;

                        const resolved = new URL(url, baseUrl).href;
                        const proxied = `${proxyBase}/?url=${encodeURIComponent(resolved)}`;
                        return `${quote}${proxied}${quote}`;
                    } catch {
                        return m;
                    }
                }
            );

            return full.replace(js, rewritten);
        }
    );
}

function buildServerProxyUrl(url, enhance) {
  const proxied = `${proxyBase}/?url=${encodeURIComponent(url)}`;
  return enhance ? `${proxied}&enhance=${encodeURIComponent(enhance)}` : proxied;
}


function proxify(link, baseUrl, proxyBase, enhance) {
  try {
    const abs = new URL(link, baseUrl).href;
    if (abs.startsWith(proxyBase)) return abs; // already proxied
    const host = new URL(abs).host;
    if (host === new URL(proxyBase).host) return abs;   // skip local redirects
    return buildServerProxyUrl(abs, enhance);
  } catch {
    return link;
  }
}







function rewriteUrls(html, baseUrl, proxyBase, enhance) {
  return html.replace(
    /(<script[\s\S]*?<\/script>)|(<style[\s\S]*?<\/style>)|([\s\S]*?)(?=<script|<style|$)/gi,
    (match, script, style, chunk) => {
      if (script || style) return match;

      return chunk
        .replace(/\b(href|src|action|data-src)=(["'])([^"'#]+)\2/gi,
          (m, attr, quote, link) =>
            `${attr}=${quote}${proxify(link, baseUrl, proxyBase, enhance)}${quote}`
        )
        .replace(/url\(([^)]+)\)/gi,
          (_, link) => `url("${proxify(link.replace(/['"]/g, ""), baseUrl, proxyBase, enhance)}")`);
    }
  );
}


function rewriteRelativeUrls(html, realBase, proxyBase) {
    // match src, href, action, data-src with relative paths starting with /
    return html.replace(/\b(src|href|action|data-src)=["'](\/[^"']*)["']/gi, (match, attr, path) => {
        try {
            // resolve relative path to absolute URL based on realBase
            const absolute = new URL(path, realBase).href;
            // wrap with proxy
            return `${attr}="${proxyBase}/?url=${encodeURIComponent(absolute)}"`;
        } catch {
            return match;
        }
    });
}

function rewriteWindowLocation(html, proxyBase, baseUrl, enhance) {
    return html.replace(
        /window\.location\.href\s*=\s*(['"])(.*?)\1/gi,
        (match, quote, url) => {
            try {
                const abs = new URL(url, baseUrl).href;
                if (abs.startsWith(proxyBase)) return match;
                return `${attr}="${buildServerProxyUrl(absolute, enhance)}"`;
            } catch {
                return match;
            }
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
            Please use the browser URL<br />
            ${proxyBase}</p>
            
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

    if (target != undefined) {
      console.log(target)
    } else {
      console.log("/")
    }

    try {
        if (new URL(target).host == new URL(proxyBase).host) {
            return res.redirect(target);
        }
    } catch (e) {}

    // 1️⃣ If no target, show homepage
    if (!target) {
        return res.send(`<!DOCTYPE html>
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
            
            input {
                width: 500px;
                border-radius: 5px;
                margin-bottom: 5px
            }
            #breakwebsiteslol {
              width: 20px;
            }
            #gotoddg {
              margin-bottom: 5px;
            }
        </style>
        </head>
        <body>

        <title>Onix Secure Browser</title>

        <div class="container">
            <h1>Onix</h1><h2>v1.3</h2>
            <hr />
            <p>
                Hello world!<br/><br/>
                This is <strong>Onix</strong>, AKA Onix Secure Browser, it's a proxy that lets you browse the internet without having to worry about your privacy. All the fetching is done on the proxy server!<br /><br/>
                In order to start browsing, add <code>?url=htps://example.com</code> after this URL, or you can enter something in any of the 2 input boxes below and browse.<br /><br />
            </p>
            <input id="browse" placeholder="Enter anything then hit Enter to browse on DuckDuckGo"></input>
            <input id="url" placeholder="Enter URL: "></input>
            <button id="gotoddg">Go to DuckDuckGo!</button>
            
            <br />
            <input id="breakwebsiteslol" type="checkbox">Enable enhance (COULD BREAK WEBSITES)</button>
            <script>
                document.getElementById("browse").addEventListener("keydown", (event) => {
                    if (event.key == "Enter") {
                        const enhance = document.getElementById("breakwebsiteslol").checked ? "" : "&enhance=stop";
                        window.location.href = \`${proxyBase}/?url=https://duckduckgo.com/?q=\${document.getElementById("browse").value}\${enhance}\`;
                    }
                })
            </script>
            <script>
                document.getElementById("gotoddg").addEventListener("click", (event) => {
                  const enhance = document.getElementById("breakwebsiteslol").checked ? "" : "&enhance=stop";
                  window.location.href = \`${proxyBase}/?url=https://duckduckgo.com\${enhance}\`;
                })
            </script>
            <script>
            
                document.getElementById("url").addEventListener("keydown", (event) => {
                    if (event.key == "Enter") {
                        const enhance = document.getElementById("breakwebsiteslol").checked ? "" : "&enhance=stop";
                        window.location.href = \`${proxyBase}/?url=\${document.getElementById("url").value}\${enhance}\`;
                    }
                })

            </script>
        </div>
        <header>
                This project is currently in beta! Expect bugs.
        </header>

        </body>
        </html>`);
    }

    // 2️⃣ Validate protocol
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
        return res.status(400).send("invalid protocol");
    }

    // 3️⃣ Safe to create URL object
    let realUrl;
    try { realUrl = new URL(target); } catch { return res.status(400).send("invalid URL"); }

    // 4️⃣ Fetch and rewrite
    try {
        const mediaExtensions = /\.(png|jpe?g|gif|webp|bmp|ico|mp4|webm|mp3|wav|ogg|ttf|woff2?)$/i;
        const isMedia = mediaExtensions.test(realUrl.pathname);

        const response = await fetch(target, { headers: { "User-Agent": "onix secure browser" } });
        const contentType = response.headers.get("content-type") || "";

        if (isMedia || contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/")) {
            // Binary → arrayBuffer
            const buffer = await response.arrayBuffer();
            res.set("Content-Type", contentType);
            return res.send(Buffer.from(buffer));
        }

        // HTML
        let body = await response.text();
        if (contentType.includes("text/html")) {
            body = rewriteScriptSrc(body, target, proxyBase, req.query.enhance);
            body = rewriteUrls(body, target, proxyBase, req.query.enhance);

            if (!req.query.enhance || req.query.enhance.search("stop") === -1) {
                body = rewriteJSUrls(body, target, proxyBase, req.query.enhance);
            }

            body = rewriteWindowLocation(body, proxyBase, target, req.query.enhance);
            body = injectBase(body, req.query.enhance);

            // Rewrite <link>, <iframe>, <img>
            body = body.replace(/<(link|iframe|img)\b[^>]*(href|src)=["']([^"']+)["'][^>]*>/gi,
                (match, tag, attr, url) => match.replace(url, proxify(url, target, proxyBase, req.query.enhance))
            );
        }

        // CSS
        else if (contentType.includes("text/css")) {
            body = body.replace(/url\(([^)]+)\)/gi, (_, raw) => {
                const clean = raw.replace(/['"]/g, "").trim();
                if (clean.startsWith("data:") || clean.startsWith("blob:") || clean.startsWith("http")) return `url(${raw})`;
                const abs = new URL(clean, target).href;
                return `url("${buildServerProxyUrl(abs, req.query.enhance)}")`;
            });
        }

        // JS or other text → send as is
        res.set("Content-Type", contentType);
        res.send(body);

    } catch (e) {
        res.status(500).send("fetch failed: " + e.message);
    }
});


server.listen(3000, () => {
    console.log("🧠 Onix recursive HTTP proxy online");
});
