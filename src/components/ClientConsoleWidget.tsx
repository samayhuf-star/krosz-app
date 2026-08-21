import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearClientConsoleEntries,
  exportClientConsoleEntries,
  subscribeClientConsole,
  type ClientConsoleEntry,
  type ClientConsoleLevel,
} from '../utils/clientConsoleStore';

const LEVEL_CLASS: Record<ClientConsoleLevel, string> = {
  log: 'text-zinc-200',
  info: 'text-sky-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
  debug: 'text-violet-300',
};

const LEVEL_TAG: Record<ClientConsoleLevel, string> = {
  log: 'LOG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
  debug: 'DBG',
};

function readStorageFlag(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function writeStorageFlag(key: string, value: boolean) {
  try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage may be unavailable in embedded/private contexts */ }
}

export default function ClientConsoleWidget() {
  const [entries, setEntries] = useState<ClientConsoleEntry[]>([]);
  const [open, setOpen] = useState(() => (typeof window !== 'undefined' ? readStorageFlag('krosz_console_open', true) : true));
  const [minimized, setMinimized] = useState(() => (typeof window !== 'undefined' ? readStorageFlag('krosz_console_minimized', false) : false));
  const [level, setLevel] = useState<ClientConsoleLevel | 'all'>('all');
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeClientConsole(setEntries), []);

  useEffect(() => {
    writeStorageFlag('krosz_console_open', open);
  }, [open]);

  useEffect(() => {
    writeStorageFlag('krosz_console_minimized', minimized);
  }, [minimized]);

  const visibleEntries = useMemo(
    () => (level === 'all' ? entries : entries.filter((entry) => entry.level === level)),
    [entries, level],
  );

  useEffect(() => {
    if (!open || minimized || !scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [visibleEntries.length, open, minimized]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-[9999] rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-semibold text-white shadow-2xl hover:bg-zinc-900"
        aria-label="Open client console"
      >
        Console · {entries.length}
      </button>
    );
  }

  return (
    <aside
      className={`fixed right-4 bottom-4 z-[9999] w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950/95 text-white shadow-2xl backdrop-blur ${
        minimized ? 'h-auto' : 'h-[min(460px,62vh)]'
      }`}
      aria-label="Live client console"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/95 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="truncate text-xs font-semibold">Live Client Console</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{entries.length}/500</span>
          </div>
        </div>

        <button
          type="button"
          onClick={exportClientConsoleEntries}
          className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
          title="Export logs"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => setMinimized((value) => !value)}
          className="h-7 w-7 rounded-md text-sm text-zinc-300 hover:bg-zinc-800"
          aria-label={minimized ? 'Restore console' : 'Minimize console'}
          title={minimized ? 'Restore' : 'Minimize'}
        >
          {minimized ? '▢' : '—'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 w-7 rounded-md text-sm text-zinc-300 hover:bg-zinc-800"
          aria-label="Close console"
          title="Close"
        >
          ×
        </button>
      </div>

      {!minimized && (
        <>
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as ClientConsoleLevel | 'all')}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none"
              aria-label="Filter console logs"
            >
              <option value="all">All levels</option>
              <option value="error">Errors</option>
              <option value="warn">Warnings</option>
              <option value="info">Info</option>
              <option value="log">Logs</option>
              <option value="debug">Debug</option>
            </select>
            <span className="flex-1 text-right text-[10px] text-zinc-500">live · newest at bottom</span>
            <button
              type="button"
              onClick={clearClientConsoleEntries}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              Clear
            </button>
          </div>

          <div
            ref={scrollerRef}
            className="h-[calc(100%-86px)] overflow-auto px-3 py-2 font-mono text-[11px] leading-5"
          >
            {visibleEntries.length === 0 ? (
              <div className="py-10 text-center text-zinc-600">No logs yet.</div>
            ) : (
              visibleEntries.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[58px_1fr] gap-2 border-b border-zinc-900 py-1 last:border-0">
                  <div className="select-none text-[10px] text-zinc-600">
                    <div className={LEVEL_CLASS[entry.level]}>{LEVEL_TAG[entry.level]}</div>
                    <div>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</div>
                  </div>
                  <pre className={`whitespace-pre-wrap break-words font-mono ${LEVEL_CLASS[entry.level]}`}>{entry.message}</pre>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
