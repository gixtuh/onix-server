import { WebSocketServer } from 'ws'
import fetch from 'node-fetch'
import HttpsProxyAgent from 'https-proxy-agent'
import dotenv from 'dotenv'
dotenv.config()

console.log(`https://${process.env.proxuser}:${process.env.proxpass}@${process.env.proxip}:${process.env.proxport}`)
const agent = new HttpsProxyAgent(`http://${process.env.proxuser}:${process.env.proxpass}@${process.env.proxip}:${process.env.proxport}`)

const wss = new WebSocketServer({port: 8080})

wss.on('connection', (client) => {
    client.on("message", async (event) => {
        try {
            let parsed = new URL(event.toString());
            var url = `https://${parsed.hostname}${parsed.pathname}${parsed.search}`
            console.log(parsed.hostname);
            
            console.log(`got website ${url}`)
            var website = await fetch(url, {agent, "headers":{"User-Agent": "Onix Secure Browser v1.0"}})
            client.send(await website.text())
        } catch (e) {
            var url = event.toString();
            console.log(`got website ${url}`)
            client.send('error')
            console.log(e)
        }
    })
})