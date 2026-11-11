import { createServer, type Server, type IncomingMessage } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile, rename, realpath, stat } from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { join, extname, resolve, isAbsolute } from 'node:path'

export interface ReviewWorker {
  stdout: { on(event: 'data', callback: (data: Buffer | string) => void): unknown } | null
  once(event: string, callback: (...args: any[]) => void): unknown
  kill(): unknown
}
export interface ReviewOpenRequest { outputDirectory: string; files: string[] }
export interface ReviewLinks { version: string; url: string; links: Array<{ file: string; url: string }> }
export interface ReviewHostOptions {
  configDirectory: string
  resourcesDirectory: string
  version: string
  spawnWorker: (entry: string, args: string[]) => ReviewWorker
  startupTimeoutMs?: number
}

/** Authenticated loopback broker. It exposes no generic process or shell execution. */
export class VisualReviewHost {
  private server: Server | null = null
  private token = randomUUID()
  private workers = new Set<ReviewWorker>()
  private pending = new Map<string, Promise<ReviewLinks>>()
  private stopped = false
  private runtimePath: string
  constructor(private options: ReviewHostOptions) {
    this.runtimePath = join(options.configDirectory, 'visual-review', 'runtime.json')
  }
  async start(): Promise<void> {
    if (this.server) return
    await mkdir(join(this.options.configDirectory, 'visual-review'), { recursive: true, mode: 0o700 })
    this.server = createServer(async (req, res) => {
      const address = this.server?.address()
      const port = address && typeof address === 'object' ? address.port : 0
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin ||
          req.headers.authorization !== `Bearer ${this.token}`) return send(403, { error: 'Review host authentication required' })
      if (req.method !== 'POST' || req.url !== '/open' || !req.headers['content-type']?.startsWith('application/json')) return send(404, { error: 'Not found' })
      try {
        const input = await this.readRequest(req)
        send(200, await this.open(input))
      } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Unable to open visual review' }) }
    })
    await new Promise<void>((done, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', done) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Review broker has no address')
    const descriptor = { schemaVersion: 1, version: this.options.version, pid: process.pid,
      url: `http://127.0.0.1:${address.port}`, token: this.token }
    const temporary = this.runtimePath + '.' + this.token + '.part'
    await writeFile(temporary, JSON.stringify(descriptor), { mode: 0o600 })
    await rename(temporary, this.runtimePath)
  }
  private async readRequest(req: IncomingMessage): Promise<ReviewOpenRequest> {
    const parts: Buffer[] = []; let size = 0
    for await (const data of req) {
      size += data.length
      if (size > 65536) throw new Error('Review request too large')
      parts.push(data)
    }
    return JSON.parse(Buffer.concat(parts).toString())
  }
  async open(input: ReviewOpenRequest): Promise<ReviewLinks> {
    if (this.stopped) throw new Error('Review host is stopping')
    if (!input || typeof input.outputDirectory !== 'string' || !isAbsolute(input.outputDirectory) ||
        !Array.isArray(input.files) || !input.files.length || input.files.length > 16 ||
        input.files.some(file => typeof file !== 'string' || !isAbsolute(file))) throw new Error('Provide an absolute feedback directory and 1–16 local files')
    const files = await Promise.all(input.files.map(file => realpath(file)))
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.html', '.htm'])
    const versions = await Promise.all(files.map(async file => {
      const info = await stat(file)
      if (!info.isFile() || !allowed.has(extname(file).toLowerCase()) || info.size > 128 * 1024 * 1024) throw new Error('Unsupported review file')
      return { size: info.size, modified: info.mtimeMs }
    }))
    const outputDirectory = resolve(input.outputDirectory)
    const packagedRoot = resolve(this.options.resourcesDirectory)
    if (outputDirectory === packagedRoot || outputDirectory.startsWith(packagedRoot + '/')) throw new Error('Feedback must be outside application resources')
    if (this.stopped) throw new Error('Review host is stopping')
    const key = createHash('sha256').update(JSON.stringify({ files, versions, outputDirectory })).digest('hex')
    const cached = this.pending.get(key)
    if (cached) return cached
    const job = this.launch(key, files, outputDirectory)
    this.pending.set(key, job)
    job.catch(() => this.pending.delete(key))
    return job
  }
  private launch(key: string, files: string[], output: string): Promise<ReviewLinks> {
    return new Promise((done, reject) => {
      const worker = this.options.spawnWorker(join(this.options.resourcesDirectory, 'server.cjs'), [output, ...files])
      this.workers.add(worker)
      let settled = false, buffer = ''
      const timeout = setTimeout(() => { worker.kill(); fail(new Error('Visual review startup timed out')) }, this.options.startupTimeoutMs ?? 15000)
      const fail = (error: Error) => { clearTimeout(timeout); if (!settled) { settled = true; reject(error) } }
      worker.once('error', () => { worker.kill(); fail(new Error('Visual review worker failed to start')) })
      worker.once('exit', () => {
        this.workers.delete(worker); this.pending.delete(key)
        fail(new Error('Visual review worker exited before it was ready'))
      })
      worker.stdout?.on('data', data => {
        if (settled) return
        buffer += data.toString()
        if (buffer.length > 8192) { worker.kill(); fail(new Error('Invalid visual review startup response')); return }
        if (!buffer.includes('\n')) return
        try {
          const url = new URL(buffer.split('\n')[0].trim())
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\/[-a-f0-9]{36}\/$/.test(url.pathname)) throw new Error('Invalid worker URL')
          if (this.stopped) { worker.kill(); throw new Error('Review host stopped') }
          settled = true; clearTimeout(timeout)
          done({ version: this.options.version, url: url.href, links: files.map((file, i) => ({ file, url: `${url.href}?asset=${i}` })) })
        } catch { worker.kill(); fail(new Error('Invalid visual review startup response')) }
      })
    })
  }
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const worker of this.workers) worker.kill()
    this.workers.clear(); this.pending.clear()
    this.server?.close(); this.server?.closeAllConnections()
    try { if (JSON.parse(readFileSync(this.runtimePath, 'utf8')).token === this.token) unlinkSync(this.runtimePath) } catch { /* Another host or no descriptor. */ }
  }
}
