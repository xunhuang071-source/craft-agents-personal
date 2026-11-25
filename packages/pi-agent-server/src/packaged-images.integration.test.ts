import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { deflateSync } from 'node:zlib';
import { createOfflineEnvironment } from './test-fixtures/offline-environment.ts';

const bundle = process.env.CRAFT_PI_TEST_BUNDLE;
const integration = bundle ? test : test.skip;

function png(width: number, height: number): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(payload.length + 8);
    result.writeUInt32BE(data.length);
    result.set(payload, 4);
    result.writeUInt32BE(Bun.hash.crc32(payload), result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    pixels.fill(row % 12 < 6 ? 30 : 220, row * stride + 1, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

integration('bundled resize worker loads Photon beside itself', async () => {
  const worker = new Worker(join(dirname(bundle!), 'image-resize-worker.js'));
  try {
    const output = await new Promise<{ type: string; result?: { width: number; height: number } }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Resize worker exited: ${code}`)));
      worker.postMessage({ inputBytes: new Uint8Array(png(2400, 1200)), mimeType: 'image/png' });
    });
    expect(output.type).toBe('pi:image-resize-response');
    expect(output.result).toMatchObject({ width: 2000, height: 1000 });
  } finally {
    await worker.terminate();
  }
}, 10000);

for (const workerAvailable of [true, false]) {
  integration(`packaged Pi sends input and tool images ${workerAvailable ? 'with worker' : 'using fallback'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-pi-images-'));
    const runtime = join(root, 'runtime');
    const project = join(root, 'project');
    await mkdir(runtime);
    await mkdir(project);
    for (const filename of [basename(bundle!), 'photon_rs_bg.wasm', ...(workerAvailable ? ['image-resize-worker.js'] : [])]) {
      await copyFile(join(dirname(bundle!), filename), join(runtime, filename));
    }
    const small = png(40, 20);
    const large = png(2400, 1200);
    const screenshot = join(project, 'screenshot.png');
    await writeFile(screenshot, large);
    const requests: string[][] = [];
    const gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const body = await request.json() as { messages: Array<{ content: unknown }> };
      const data = JSON.stringify(body.messages);
      requests.push(data.match(/data:image\/[^;\"]+;base64,[A-Za-z0-9+/=]+/g) ?? []);
      const read = { index: 0, id: 'read-image', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: screenshot }) } };
      const first = requests.length === 1;
      const chunk = (delta: object, reason: string | null) => JSON.stringify({
        id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-vision', created: 1,
        choices: [{ index: 0, delta, finish_reason: reason }],
      });
      return new Response(`data: ${chunk(first ? { role: 'assistant', tool_calls: [read] } : { role: 'assistant', content: 'Received.' }, null)}\n\ndata: ${chunk({}, first ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    } });
    const child = spawn(process.execPath, ['--preload', join(import.meta.dir, 'test-fixtures/openai-loopback-network.ts'), join(runtime, basename(bundle!))], {
      cwd: project, env: { ...createOfflineEnvironment(root), CRAFT_PI_TEST_ORIGIN: gateway.url.origin }, stdio: 'pipe',
    });
    const closed = new Promise(resolve => child.once('close', resolve));
    const rows: Array<Record<string, any>> = [];
    let stderr = '';
    child.stderr.on('data', data => { stderr += String(data); });
    const send = (row: object) => child.stdin.write(JSON.stringify(row) + '\n');
    createInterface({ input: child.stdout }).on('line', line => {
      let row;
      try { row = JSON.parse(line); } catch { return; }
      rows.push(row);
      if (row.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: row.requestId, action: 'allow' });
    });
    async function waitFor(predicate: () => boolean) {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (predicate()) return;
        if (child.exitCode !== null) break;
        await Bun.sleep(20);
      }
      throw new Error(`Image fixture did not finish: ${JSON.stringify(rows.map(row => [row.type, row.event?.type, row.message]))}\n${stderr}`);
    }
    try {
      send({ type: 'init', apiKey: 'fixture-only', model: 'fixture-vision', cwd: project, workingDirectory: project,
        thinkingLevel: 'off', workspaceRootPath: root, workspaceId: 'fixture', sessionId: 'image', sessionPath: root,
        plansFolderPath: join(root, 'plans'), providerType: 'pi_compat', authType: 'api_key_with_endpoint',
        baseUrl: `${gateway.url.origin}/v1`, customEndpoint: { api: 'openai-completions' },
        customModels: [{ id: 'fixture-vision', supportsImages: true }],
      });
      await waitFor(() => rows.some(row => row.type === 'ready'));
      send({ type: 'prompt', id: 'prompt', message: 'Read the saved screenshot too.', systemPrompt: 'Image fixture.',
        images: [small, large].map(data => ({ type: 'image', mimeType: 'image/png', data: data.toString('base64') })),
      });
      await waitFor(() => rows.some(row => row.type === 'event' && row.event?.type === 'agent_end'));
      expect(rows.filter(row => row.type === 'error')).toEqual([]);
      expect(requests.map(images => images.length)).toEqual([2, 3]);
      expect(requests[0]![0]).toEndWith(small.toString('base64'));
      for (const image of [requests[0]![1]!, requests[1]![2]!]) {
        expect(image).toStartWith('data:image/png;base64,');
        const bytes = Buffer.from(image.split(',')[1]!, 'base64');
        expect(bytes.readUInt32BE(16)).toBe(2000);
        expect(bytes.readUInt32BE(20)).toBe(1000);
      }
    } finally {
      child.kill();
      await closed;
      gateway.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
}
