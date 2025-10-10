import { WebSocketServer } from 'ws'
import fetch from 'node-fetch'
import HttpsProxyAgent from 'https-proxy-agent'
import dotenv from 'dotenv'
import * as cheerio from 'cheerio'
dotenv.config()

let PROXY

if (process.env.proxpassword == "false") {
    PROXY = `http://${process.env.proxip}:${process.env.proxport}`
} else {
    PROXY = `http://${encodeURIComponent(process.env.proxuser)}:${encodeURIComponent(process.env.proxpass)}@${process.env.proxip}:${process.env.proxport}`
}

const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...opts, signal: controller.signal })
    } finally {
        clearTimeout(id)
    }
}

async function inlineResources(html, baseUrl, client, fetchOpts = {}, {
    concurrency = 6,
    imageSizeLimit = 2 * 1024 * 1024,
    videoSizeLimit = 5 * 1024 * 1024,
    resourceTimeout = 10000
} = {}) {
    const $ = cheerio.load(html)
    const resources = []
    
    $('link[rel="stylesheet"]').each((_, el) => {
        const href = $(el).attr('href')
        if (href) resources.push({ type: 'css', el, url: new URL(href, baseUrl).href })
        })
    $('script[src]').each((_, el) => {
        const src = $(el).attr('src')
        if (src) resources.push({ type: 'js', el, url: new URL(src, baseUrl).href })
        })
    $('img[src]').each((_, el) => {
        const src = $(el).attr('src')
        if (src) resources.push({ type: 'img', el, url: new URL(src, baseUrl).href })
        })
    $('video source[src], video[src]').each((_, el) => {
        const src = $(el).attr('src')
        if (src) resources.push({ type: 'video', el, url: new URL(src, baseUrl).href })
        })
    
    for (let i = 0; i < resources.length; i += concurrency) {
        const batch = resources.slice(i, i + concurrency)
        await Promise.allSettled(batch.map(async (r) => {
            client.send(r.url)
            try {
                const res = await fetchWithTimeout(r.url, fetchOpts, resourceTimeout)
                if (!res || !res.ok) throw new Error(`status ${res ? res.status : 'no response'}`)
                    
                if (r.type === 'css') {
                    const txt = await res.text()
                    $(r.el).replaceWith(`<style>${txt}</style>`)
                    client.send(r.url)
                    return
                }
                
                if (r.type === 'js') {
                    const txt = await res.text()
                    $(r.el).removeAttr('src').text(txt)
                    client.send(r.url)
                    return
                }
                
                if (r.type === 'img' || r.type === 'video') {
                    const cl = res.headers.get('content-length')
                    const limit = r.type === 'img' ? imageSizeLimit : videoSizeLimit
                    if (cl && Number(cl) > limit) return
                    const ab = await res.arrayBuffer()
                    const buf = Buffer.from(ab)
                    if (buf.length > limit) return
                    const mime = res.headers.get('content-type') || (r.type === 'img' ? 'image/png' : 'video/mp4')
                    const dataUri = `data:${mime};base64,${buf.toString('base64')}`
                    $(r.el).attr('src', dataUri)
                    client.send(r.url)
                }
            } catch (err) {
                client.send(err.message)
            }
        }))
    }
    
    return $.html()
}

const wss = new WebSocketServer({ port: 8080 })
console.log('🌐 WebSocket server on :8080')

wss.on('connection', (client) => {
    client.on('message', async (event) => {
        const raw = event.toString().trim()
        let parsed
        try {
            parsed = new URL(raw)
        } catch {
            parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
        }
        
        const baseUrl = `${parsed.protocol}//${parsed.hostname}`
        const url = `${baseUrl}${parsed.pathname}${parsed.search}`
        console.log(`🔗 Got website: ${url}`)
        
        try {
            const res = await fetchWithTimeout(url, { 
                //agent, 
                headers: { 'User-Agent': 'Onix Secure Browser v1.0' } 
            }, 15000)
            const html = await res.text()
            
            setImmediate(async () => {
                const inlined = await inlineResources(html, baseUrl, client, { 
                    //agent
                 }, {})
                setTimeout(() => {
                    client.send(inlined)
                }, 1000);
            })
        } catch (e) {
            client.send("err: "+e.message)
        }
    })
})
