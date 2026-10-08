// Probe RapidAPI MCP server untuk list tools (endpoint) Forex Factory Scraper
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'x-api-host': process.env.RAPIDAPI_FF_HOST,
  'x-api-key': process.env.RAPIDAPI_KEY,
};

function parseBody(data) {
  if (typeof data !== 'string') return data;
  const lines = data.split('\n').filter(l => l.startsWith('data:'));
  if (lines.length) return lines.map(l => JSON.parse(l.slice(5).trim()));
  try { return JSON.parse(data); } catch { return data; }
}

const init = await axios.post('https://mcp.rapidapi.com', {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1.0' } },
}, { headers, responseType: 'text', validateStatus: () => true });
console.log('INIT', init.status, JSON.stringify(parseBody(init.data)).slice(0, 500));
const sid = init.headers['mcp-session-id'];
if (sid) headers['mcp-session-id'] = sid;

await axios.post('https://mcp.rapidapi.com', { jsonrpc: '2.0', method: 'notifications/initialized' }, { headers, validateStatus: () => true });

const list = await axios.post('https://mcp.rapidapi.com', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { headers, responseType: 'text', validateStatus: () => true });
console.log('TOOLS', list.status);
console.log(JSON.stringify(parseBody(list.data), null, 2));
