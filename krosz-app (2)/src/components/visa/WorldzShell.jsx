import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import WorldzSidebar from './WorldzSidebar';
import WorldzTopbar from './WorldzTopbar';
import AskAIPanel from './AskAIPanel';

export default function WorldzShell() {
  const [askOpen, setAskOpen] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <WorldzSidebar />
      <main className="min-w-0 pb-16 md:ml-64 md:pb-0">
        <WorldzTopbar onAskAI={() => setAskOpen(true)} />
        <Outlet />
      </main>
      <AskAIPanel open={askOpen} onClose={() => setAskOpen(false)} />
    </div>
  );
}