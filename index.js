import express from "express";
import fetch from "node-fetch";
import { URL } from "url";
import http from "http";
import WebSocket, { WebSocketServer } from "ws"; // ws package

const app = express()
app.set("trust proxy", true);

// npm i express node-fetch url http ws

let cachedServerIp = null;

async function getServerIP() {
  if (cachedServerIp) return cachedServerIp;
  try {
    const res = await fetch("https://ifconfig.me/ip");
    cachedServerIp = (await res.text()).trim();
    console.log("asdnhajkdhmasjkcdhnvaahndvadhvasajk cached proxy ip address")
    return cachedServerIp;
  } catch {
    console.log("proxy ip address failed to fetch")
    return "unknown";
  }
}

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


function rewriteStandaloneJS(js, baseUrl, proxyBase, enhance) {
  return js.replace(
    /(['"`])((?:https?:\/\/|\/\/|\/|\.\.?\/)[^'"`\s]+)\1/g,
    (m, quote, url) => {
      try {
        // handle protocol-relative URLs
        if (url.startsWith("//")) {
          url = new URL("http:" + url).href;
        }

        const abs = new URL(url, baseUrl).href;

        // skip already proxied
        if (abs.startsWith(proxyBase)) return m;

        return `${quote}${buildServerProxyUrl(abs, enhance, proxyBase)}${quote}`;
      } catch {
        return m;
      }
    }
  );
}

function rewriteStandaloneCSS(css, baseUrl, proxyBase, enhance) {
  return css
    // url(...)
    .replace(/url\(([^)]+)\)/gi, (_, raw) => {
      const clean = raw.replace(/['"]/g, "").trim();

      if (
        clean.startsWith("data:") ||
        clean.startsWith("blob:")
      ) {
        return `url(${raw})`;
      }

      try {
        const abs = new URL(clean, baseUrl).href;
        return `url("${buildServerProxyUrl(abs, enhance, proxyBase)}")`;
      } catch {
        return `url(${raw})`;
      }
    })

    // @import "...";
    .replace(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?/gi, (m, url) => {
      try {
        const abs = new URL(url, baseUrl).href;
        return `@import url("${buildServerProxyUrl(abs, enhance, proxyBase)}")`;
      } catch {
        return m;
      }
    });
}






// browser-side code inside injectBase should NOT contain this function
function injectBase(html, enhancer, clientip, serverip, proxyBase) {
  console.log(`BaseInjector: "${enhancer}"`)
  const injection = `
<script>
(() => {
  const host = document.createElement("div");
  host.id = "__onix_header_host";

  // make it impossible to interact with
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.zIndex = "2147483647";

  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = \`
    <style>
      header {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        padding: 10px;
        font-family: sans-serif;
        text-align: center;
        background: #e8e8e8ff;
        color: black;
        animation: appear 5s ease forwards;
      }

      .switchButton__onix {
        border-radius: 10px;
        border: 1px solid #000000;
        background-color: #a3a3a3;
        color: black;
        transition: all 0.1s ease;
      }

      .switchButton__onix:hover {
        background-color: #747474;
      }
      .switchButton__onix:active {
        transform: scale(0.95)
      }

      @keyframes appear {
        0% { transform: translateY(-120px); opacity: 1; }
        33% { transform: translateY(0); opacity: 1; }
        66% { transform: translateY(0); opacity: 1; }
        100% { transform: translateY(-120px); opacity: 0; }
      }
    </style>

    <header>
  Onix Secure Browser | ${!enhancer
    ? `<button class= "switchButton__onix" onclick="window.location.href=\\\`${proxyBase}/?enhance=stop&url=\${new URLSearchParams(window.location.search).get('url')}\\\`\">`: `<button class= "switchButton__onix" onclick=\"window.location.href=\\\`${proxyBase}/?url=\${new URLSearchParams(window.location.search).get('url')}\\\`">`}
  ${enhancer === "stop"
  ? "You should enhance now."
  : enhancer === "proxyExternal" ? "Switch to enhanced version"
  : "Switch to unenhanced version"
}</button><br />
You're currently using the ${
  enhancer === "proxyExternal"
    ? "external script proxying version (VERY unstable but secure)"
    : enhancer === "stop"
      ? "unenhanced version"
      : "enhanced version"
}



      <hr />
      ${clientip} → ${serverip}
      <br />
    </header>
  \`;
})();
</script>


<script>
(() => {
  const PROXY_BASE = "${proxyBase}";
  const urlParams = new URLSearchParams(window.location.search);
  const REAL_BASE = urlParams.get("url");
  const ENHANCE =
  "${enhancer}" === "undefined" ? undefined : "${enhancer}";


  if (ENHANCE !== "stop") {
    // Block all WebSocket connections
    window.WebSocket = class {
      constructor() {
        console.error("Onix Secure Browser blocked WebSockets to keep security.\\nDisable enhancement to unblock WebSockets.");
      }
      // Mock the common methods so scripts don’t crash
      send() { console.error("WebSocket disabled"); }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }

  if (!REAL_BASE) return;

  function buildProxyUrl(target) {
  try {
    const abs = new URL(target, REAL_BASE).href;
    // ⚡ skip if already proxied
    if (abs.startsWith(PROXY_BASE)) return abs;
    return PROXY_BASE + "/?url=" + encodeURIComponent(abs) + (ENHANCE ? "&enhance=" + encodeURIComponent(ENHANCE) : "");
  } catch {
    return target; // fallback
  }
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
        finalUrl = "${proxyBase}" + "${enhancer == undefined ? "/?url=" : "/?enhance="+enhancer+"&url="}" + new URLSearchParams(new URL(form.action).search).get("url") + encodeURIComponent("?" + new URLSearchParams(formData).toString())
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
                        const abs = new URL(url, baseUrl).href;
                        // ✅ skip if internal (same host)
                        if (new URL(abs).host === new URL(baseUrl).host) return m;
                        // ✅ skip if already proxied
                        if (abs.startsWith(proxyBase)) return m;

                        const proxied = `${proxyBase}/?url=${encodeURIComponent(abs)}`;
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


function buildServerProxyUrl(url, enhance, proxyBase) {
  const proxied = `${proxyBase}/?url=${encodeURIComponent(url)}`;
  return enhance !== undefined && enhance !== "undefined"
  ? `${proxied}&enhance=${encodeURIComponent(enhance)}`
  : proxied;
}


function proxify(link, baseUrl, proxyBase, enhance) {
  function ensureTrailingSlash(url) {
    return url.endsWith("/") ? url : url + "/";
  }

  try {
    let abs
    if (enhance == undefined) {
      abs = new URL(link, ensureTrailingSlash(baseUrl)).href;
    } else {
      abs = new URL(link, baseUrl).href;
    }
    if (abs.startsWith(proxyBase)) return abs; // already proxied
    const host = new URL(abs).host;
    if (host === new URL(proxyBase).host) return abs;   // skip local redirects
    return buildServerProxyUrl(abs, enhance, proxyBase);
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
          (_, link) => `url("${proxify(link.replace(/['"]/g, ""), baseUrl, proxyBase, enhance)}")`)
        .replace(/\bstyle=(["'])([\s\S]*?)\1/gi, (m, quote, style) => {
          const rewritten = style.replace(/url\(([^)]+)\)/gi, (_, raw) => {
            const clean = raw.replace(/['"]/g, "").trim();

            if (clean.startsWith("data:") || clean.startsWith("blob:")) {
              return `url(${raw})`;
            }

            try {
              return `url("${proxify(clean, baseUrl, proxyBase, enhance)}")`;
            } catch {
              return `url(${raw})`;
            }
          });

          return `style=${quote}${rewritten}${quote}`;
        })

    }
  );
}

function rewriteWindowLocation(html, proxyBase, baseUrl, enhance) {
    return html.replace(
        /window\.location\.href\s*=\s*(['"])(.*?)\1/gi,
        (match, quote, url) => {
            try {
                const abs = new URL(url, baseUrl).href;
                if (abs.startsWith(proxyBase)) return match;
                return `window.location.href=${quote}${buildServerProxyUrl(abs, enhance, proxyBase)}${quote}`;
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
  const proxyBase =
        req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
            ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
            : `http://${req.headers.host}`;

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
    // sanitize the query param right away
    const enhance =
      req.query.enhance === undefined || req.query.enhance === "undefined"
        ? undefined
        : req.query.enhance;

    const proxyBase = req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
      : `${req.protocol}://${req.headers.host}`;

    const target = req.query.url;

    const serverIp = await getServerIP();
let message;

if (req.ip.includes("127.0.0.1") || req.ip === serverIp) {
  message = "- oh look it's you aka " + (req.ip.includes("127.0.0.1") ? "the localhost " + req.ip : " "+req.ip);
} else {
  message = req.ip;
}

console.log(`it's uhh${message}`);

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
        const serverip = await getServerIP();
        return res.send(`<!DOCTYPE html>
        <html>
        <head>
        <style>
            body { text-align:center; font-family:sans-serif; background-color:#f4f4f4; padding-top:50px; margin:0; display:flex; justify-content:center; }
            .container { max-width:600px; animation: appear 0.8s ease-out 0.2s both; }
            @keyframes appear { 0% {opacity:0;filter:blur(15px);transform:scale(0.95) translateY(20px);} 100% {opacity:1;filter:blur(0);transform:scale(1) translateY(0);} }
            header { animation: appear 0.8s ease-out 0.2s both; background-color: grey; position: fixed; width:100%; bottom:0px; left:0px; align-items:center; padding:10px; text-align:center; }
            input { width:500px; border-radius:5px; margin-bottom:5px }
            #breakwebsiteslol { width:20px; }
            #verysecureiguess { width:20px; }
            #gotoddg { margin-bottom:5px; }
        </style>
        </head>
        <body>

        <title>Onix Secure Browser</title>

        <div class="container">
            <h1>Onix</h1><h2>v1.5.7</h2>
            <hr />
            <p>
                This is <strong>Onix</strong>, also known as <strong>Onix Secure Browser</strong>, it's a proxy that lets you browse without worrying about DNS website blocking.<br /><br/>
                In order to start browsing, add <code>?url=https://example.com</code> after this URL, or you can enter something in any of the 2 input boxes below and browse.<br /><br />
            </p>
            <input id="browse" placeholder="Enter anything then hit Enter to browse on DuckDuckGo"></input>
            <input id="url" placeholder="Enter URL: "></input>
            <button id="gotoddg">Go to DuckDuckGo!</button><button id="gotoimages">Browse images</button>
            
            <br />
            <input id="breakwebsiteslol" type="checkbox" checked>Enable enhancements</input><br />
            <input id="verysecureiguess" type="checkbox">Enable proxying external scripts (more unstable but secure)</input><br /><br />
            Proxy IP Address: ${serverip}<br/><strong style="color:red;">! THIS IP IS SHARED WITH EVERYONE AND DOESN'T CHANGE !</strong>
            <script>
              const enhance = document.getElementById("breakwebsiteslol");
              const proxy = document.getElementById("verysecureiguess");

              function sync(a, b) {
                a.addEventListener("change", () => {
                  if (a.checked) {
                    b.checked = false;
                  }
                });
              }

              sync(enhance, proxy);
              sync(proxy, enhance);
            </script>

            <script>
                document.getElementById("browse").addEventListener("keydown", (event) => {
                    if (event.key == "Enter") {
                        const enhance = document.getElementById("breakwebsiteslol").checked ? "" : document.getElementById("verysecureiguess").checked ? "&enhance=proxyExternal" : "&enhance=stop";
                        window.location.href = \`${proxyBase}/?url=https://duckduckgo.com/?q=\${document.getElementById("browse").value}\${enhance}\`;
                    }
                })
                document.getElementById("gotoddg").addEventListener("click", (event) => {
                  const enhance = document.getElementById("breakwebsiteslol").checked ? "" : document.getElementById("verysecureiguess").checked ? "&enhance=proxyExternal" : "&enhance=stop";
                  window.location.href = \`${proxyBase}/?url=https://duckduckgo.com\${enhance}\`;
                })
                document.getElementById("gotoimages").addEventListener("click", (event) => {
                  const enhance = document.getElementById("breakwebsiteslol").checked ? "" : document.getElementById("verysecureiguess").checked ? "&enhance=proxyExternal" : "&enhance=stop";
                  window.location.href = \`${proxyBase}/?url=https://images.google.com\${enhance}\`;
                })
                document.getElementById("url").addEventListener("keydown", (event) => {
                    if (event.key == "Enter") {
                        const enhance = document.getElementById("breakwebsiteslol").checked ? "" : document.getElementById("verysecureiguess").checked ? "&enhance=proxyExternal" : "&enhance=stop";
                        window.location.href = \`${proxyBase}/?url=\${document.getElementById("url").value}\${enhance}\`;
                    }
                })
            </script>
        </div>
        <header>
                This project is currently in beta! Expect bugs.<br />Onix v1.6 came out, but it uses a different website, go to <a href="https://tinyurl.com/onixsb">https://tinyurl.com/onixsb</a>.
        </header>

        </body>
        </html>`);
    }

    // 2️⃣ Validate protocol
    if (!target.startsWith("http://") && !target.startsWith("https://") && !target.startsWith("data:image")) {
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
            const buffer = await response.arrayBuffer();
            res.set("Content-Type", contentType);
            return res.send(Buffer.from(buffer));
        }

        let body = await response.text();
        const serverip = await getServerIP();

        // HTML
        if (contentType.includes("text/html")) {
            body = rewriteUrls(body, target, proxyBase, enhance);
            body = rewriteScriptSrc(body, target, proxyBase, enhance);

            if (!enhance || enhance.search("stop") === -1 || enhance === "proxyExternal") {
                body = rewriteJSUrls(body, target, proxyBase, enhance);
                body = rewriteWindowLocation(body, proxyBase, target, enhance);
            }

            body = injectBase(body, enhance, req.ip, serverip, proxyBase);

            body = body.replace(/<(link|iframe|img)\b[^>]*(href|src)=["']([^"']+)["'][^>]*>/gi,
                (match, tag, attr, url) => match.replace(url, proxify(url, target, proxyBase, enhance))
            );
        }

        // JS standalone rewrite
        if (enhance === "proxyExternal" && contentType.includes("javascript")) {
            body = rewriteStandaloneJS(body, target, proxyBase, enhance);
        }

        // CSS standalone rewrite
        if (enhance === "proxyExternal" && contentType.includes("text/css")) {
            body = rewriteStandaloneCSS(body, target, proxyBase, enhance);
        }

        res.set("Content-Type", contentType);
        res.send(body);

    } catch (e) {
        res.status(500).send("fetch failed: " + e.message);
    }
});


server.listen(3000, async () => {
console.log("")
console.log("")
console.log(" ██████╗ ███╗   ██╗██╗██╗  ██╗")
console.log("██╔═══██╗████╗  ██║██║╚██╗██╔╝")
console.log("██║   ██║██╔██╗ ██║██║ ╚███╔╝ ")
console.log("██║   ██║██║╚██╗██║██║ ██╔██╗ ")
console.log("╚██████╔╝██║ ╚████║██║██╔╝ ██╗")
console.log(" ╚═════╝ ╚═╝  ╚═══╝╚═╝╚═╝  ╚═╝")
console.warn("Your IP Address is now being used as a proxy on port 3000")
console.warn("Oh and please for gods sake get a VPN before tunneling this with idk cloudflared maybe")
console.warn("we log ips but if you dare friggin dox anyone with it we'll call the fbi on you")
console.log()
console.log("getting your ip just so you knew if your ip is proxified")
console.log(`ok ip is ${await getServerIP()}`)
});