import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';

const PORT = Number(process.env.UI_PORT ?? 5174);

/**
 * Bound to loopback, with no authentication, because this is a single-user
 * local tool that can start real job applications. Exposing it on 0.0.0.0 or
 * over Tailscale would put that capability on the network with nothing in
 * front of it -- do not change this host without adding auth first.
 */
const HOST = '127.0.0.1';

const app = buildApp();

const dist = join(process.cwd(), 'ui', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  // Client-side routing: anything that is not an API call is the SPA.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
  const mode = existsSync(dist) ? 'serving ui/dist' : 'API only - run `npm run ui` for the interface';
  console.log(`JobPilot API on http://${HOST}:${PORT}  (${mode})`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
