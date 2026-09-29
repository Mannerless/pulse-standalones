// In-memory console capture: mirrors server console output + browser errors for the in-window console panel.
import util from 'node:util';

const MAX = 600;
const lines = [];
let seq = 0;

export function addLine(level, msg, src = 'server') {
  lines.push({ id: ++seq, t: new Date().toISOString().slice(11, 23), level, src, msg: String(msg).slice(0, 4000) });
  if (lines.length > MAX) lines.shift();
}

export function installConsoleCapture() {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); try { addLine(level === 'info' ? 'log' : level, util.format(...args)); } catch {} };
  }
  process.on('uncaughtException', (e) => { addLine('error', `uncaughtException: ${e?.stack || e}`); });
  process.on('unhandledRejection', (e) => { addLine('error', `unhandledRejection: ${e?.stack || e}`); });
}

export const getLines = (since = 0) => lines.filter((l) => l.id > since);
export const clearLines = () => { lines.length = 0; addLine('log', 'console cleared'); };
