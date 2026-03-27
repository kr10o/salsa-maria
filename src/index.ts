import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { basicAuth } from 'hono/basic-auth'
import UAParser from 'ua-parser-js'

// Define Cloudflare bindings
type Bindings = {
  SALSA_KV: KVNamespace;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Allow your frontend to talk to this backend
app.use('/api/*', cors())

// ==========================================
// 🌮 PUBLIC API ROUTES (For Alpine.js)
// ==========================================

app.get('/api/translations/:lang', async (c) => {
  const lang = c.req.param('lang')
  const translations = await c.env.SALSA_KV.get(`translations:${lang}`, 'json')
  return translations ? c.json(translations) : c.json({ error: 'Not found' }, 404)
})

app.get('/api/products', async (c) => {
  const products = await c.env.SALSA_KV.get('products:list', 'json')
  return products ? c.json(products) : c.json({ error: 'Not found' }, 404)
})

app.get('/api/posts', async (c) => {
  const posts = await c.env.SALSA_KV.get('posts:list', 'json')
  return posts ? c.json(posts) : c.json({ error: 'Not found' }, 404)
})

app.get('/api/clock', (c) => {
  const now = new Date()
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(now)

  return c.json({ time: localTime, location: 'Koprivnica, Croatia', timestamp: now.getTime() })
})

app.post('/api/analytics', async (c) => {
  try {
    const body = await c.req.json()
    const rawUA = c.req.header('User-Agent') || ''
    
    const parser = new UAParser(rawUA)
    const analyticsRecord = {
      timestamp: new Date().toISOString(),
      timeOnPage: body.timeOnPage,
      path: body.path,
      cartValue: body.cartValue,
      browser: parser.getBrowser().name,
      os: parser.getOS().name,
      deviceType: parser.getDevice().type || 'desktop'
    }

    const recordKey = `analytics:${Date.now()}-${Math.random().toString(36).substring(7)}`
    await c.env.SALSA_KV.put(recordKey, JSON.stringify(analyticsRecord))

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: 'Analytics failed' }, 500)
  }
})

// ==========================================
// 🔒 SECURE ADMIN AREA
// ==========================================

app.use('/admin/*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.ADMIN_USERNAME || 'admin',
    password: c.env.ADMIN_PASSWORD || 'password' 
  })
  return auth(c, next)
})

app.get('/admin/api/stats', async (c) => {
  const { keys } = await c.env.SALSA_KV.list({ prefix: 'analytics:' })
  if (keys.length === 0) return c.json({ totalViews: 0, avgTimeOnPage: 0, totalCartValue: 0, deviceCounts: {}, recent: [] })

  const records = await Promise.all(keys.map(key => c.env.SALSA_KV.get(key.name, 'json')))
  const validRecords = records.filter((r: any) => r !== null)

  let totalTime = 0, totalCartValue = 0;
  const deviceCounts: any = {}

  validRecords.forEach((record: any) => {
    totalTime += (record.timeOnPage || 0)
    totalCartValue += parseFloat(record.cartValue || 0)
    const device = record.deviceType || 'unknown'
    deviceCounts[device] = (deviceCounts[device] || 0) + 1
  })

  return c.json({
    totalViews: validRecords.length,
    avgTimeOnPage: Math.round(totalTime / validRecords.length),
    totalCartValue: totalCartValue.toFixed(2),
    deviceCounts,
    recent: validRecords.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10)
  })
})

app.get('/admin/dashboard', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>La Maria Admin</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
    </head>
    <body class="p-8 bg-gray-100" x-data="adminApp()">
      <h1 class="text-3xl font-bold mb-6">La Maria Analytics</h1>
      <div class="grid grid-cols-3 gap-4 mb-8">
        <div class="bg-white p-4 rounded shadow">
          <p class="text-gray-500 text-sm">Total Views</p>
          <p class="text-2xl font-bold" x-text="stats.totalViews"></p>
        </div>
        <div class="bg-white p-4 rounded shadow">
          <p class="text-gray-500 text-sm">Avg Time (s)</p>
          <p class="text-2xl font-bold" x-text="stats.avgTimeOnPage"></p>
        </div>
        <div class="bg-white p-4 rounded shadow">
          <p class="text-gray-500 text-sm">Cart Value</p>
          <p class="text-2xl font-bold text-green-600">€<span x-text="stats.totalCartValue"></span></p>
        </div>
      </div>
      <script>
        document.addEventListener('alpine:init', () => {
          Alpine.data('adminApp', () => ({
            stats: { totalViews: 0, avgTimeOnPage: 0, totalCartValue: 0 },
            async init() {
              const res = await fetch('/admin/api/stats');
              if(res.ok) this.stats = await res.json();
            }
          }));
        });
      </script>
    </body>
    </html>
  `)
})

export default app