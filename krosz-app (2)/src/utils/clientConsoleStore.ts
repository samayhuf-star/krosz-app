export type ClientConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ClientConsoleEntry {
  id: number;
  timestamp: string;
  level: ClientConsoleLevel;
  message: string;
}

const MAX_ENTRIES = 500;
const listeners = new Set<(entries: ClientConsoleEntry[]) => void>();
let entries: ClientConsoleEntry[] = [];
let nextId = 1;
let installed = false;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    const snapshot = entries;
    listeners.forEach((listener) => {
      try { listener(snapshot); } catch { /* observers must never break logging */ }
    });
  }, 100);
}

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|session|credit.?card|card.?number|cvv|aadhaar|pan)/i;
const TOKEN_LIKE = /\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{10,}|\b(?:sk|re|pk|api)[-_][A-Za-z0-9_-]{16,}/gi;

function redactString(value: string): string {
  return value
    .replace(TOKEN_LIKE, '[REDACTED]')
    .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, '$1[REDACTED]');
}

function safeSerialize(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value == null) return String(value);
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return redactString(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`);
  if (depth > 3) return '[Max depth]';

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return `[${value.slice(0, 30).map((item) => safeSerialize(item, depth + 1, seen)).join(', ')}${value.length > 30 ? ', …' : ''}]`;
    }

    try {
      const obj = value as Record<string, unknown>;
      const pairs = Object.keys(obj).slice(0, 40).map((key) => {
        const rendered = SENSITIVE_KEY.test(key) ? '[REDACTED]' : safeSerialize(obj[key], depth + 1, seen);
        return `${key}: ${rendered}`;
      });
      return `{${pairs.join(', ')}${Object.keys(obj).length > 40 ? ', …' : ''}}`;
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  return redactString(String(value));
}

function push(level: ClientConsoleLevel, args: unknown[]) {
  const message = args.map((arg) => safeSerialize(arg)).join(' ');
  const entry: ClientConsoleEntry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level,
    message: message.length > 8000 ? `${message.slice(0, 8000)}…` : message,
  };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  scheduleNotify();
}

export function installClientConsoleCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  (['log', 'info', 'warn', 'error', 'debug'] as ClientConsoleLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try { push(level, args); } catch { /* never break app logging */ }
      original(...args);
    };
  });

  window.addEventListener('error', (event) => {
    push('error', [
      'Window error:',
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
      event.error || '',
    ]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    push('error', ['Unhandled promise rejection:', event.reason]);
  });

  push('info', ['Client console capture enabled']);
}

export function subscribeClientConsole(listener: (next: ClientConsoleEntry[]) => void) {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function getClientConsoleEntries() {
  return entries;
}

export function clearClientConsoleEntries() {
  entries = [];
  scheduleNotify();
}

export function exportClientConsoleEntries() {
  const header = [
    'Krosz Client Console Export',
    `Exported: ${new Date().toISOString()}`,
    `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
    `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    '',
  ].join('\n');

  const body = entries
    .map((entry) => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`)
    .join('\n');

  const blob = new Blob([header, body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `krosz-console-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
