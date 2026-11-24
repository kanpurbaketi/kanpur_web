// Run a list of Katpootli MCP tool calls in one session (the server: $KATPOOTLI_MCP, the katpootli-mcp package's
// folder): node kp.mjs job.json outdir. Rendered pictures go to outdir.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const MCP = process.env.KATPOOTLI_MCP ?? new URL('../../../../katputli/mcp', import.meta.url).pathname;
const SDK = `${MCP}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/`;
const { Client } = await import(SDK + 'index.js');
const { StdioClientTransport } = await import(SDK + 'stdio.js');
const [job, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const steps = JSON.parse(readFileSync(job, 'utf8'));
const t = new StdioClientTransport({ command: 'node', args: [`${MCP}/dist/server.js`], stderr: 'inherit' });
const c = new Client({ name: 'kp', version: '1' });
await c.connect(t);
let n = 0;
for (const s of steps) {
  const r = await c.callTool({ name: s.tool, arguments: s.args ?? {} }, undefined, { timeout: 600000 });
  for (const part of r.content) {
    if (part.type === 'image') { const f = `${out}/${String(n).padStart(2, '0')}_${s.name ?? s.tool}.png`; writeFileSync(f, Buffer.from(part.data, 'base64')); console.log('IMG', f); }
    else console.log(`[${s.tool}${r.isError ? ' ERROR' : ''}]`, (part.text ?? '').slice(0, s.full ? 100000 : 1500));
  }
  n++;
}
await c.close();
process.exit(0);
