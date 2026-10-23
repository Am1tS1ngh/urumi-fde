import { createUtilsServer } from './app.mjs';

const port = Number(process.env.PORT ?? 3002);
const host = process.env.HOST ?? '127.0.0.1';

try {
  const server = createUtilsServer(process.env.UTILS_MCP_API_KEY);
  server.listen(port, host, () => console.log(`Utils MCP listening at http://${host}:${port}/mcp`));
  const shutdown = () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
