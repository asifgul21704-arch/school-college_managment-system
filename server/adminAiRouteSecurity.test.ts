import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { router } from './routes.ts';

test('admin AI HTTP endpoints reject unauthenticated requests', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server: Server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    for (const endpoint of ['/admin/ai/query', '/admin/ai/execute-action']) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'test', actionType: 'test', confirmed: true }),
      });

      assert.equal(response.status, 401, `${endpoint} must reject missing authentication`);
      const payload = await response.json() as { error?: string };
      assert.match(payload.error || '', /authentication|required|token/i);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
