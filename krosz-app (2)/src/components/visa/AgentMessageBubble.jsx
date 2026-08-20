import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Check, Loader2, AlertTriangle, Wrench } from "lucide-react";

const STATUS_META = {
  pending: { icon: Loader2, cls: "text-slate-400", spin: true, label: "pending" },
  running: { icon: Loader2, cls: "text-blue-500", spin: true, label: "running" },
  in_progress: { icon: Loader2, cls: "text-blue-500", spin: true, label: "in progress" },
  completed: { icon: Check, cls: "text-orange-600", spin: false, label: "completed" },
  success: { icon: Check, cls: "text-orange-600", spin: false, label: "success" },
  failed: { icon: AlertTriangle, cls: "text-red-500", spin: false, label: "failed" },
  error: { icon: AlertTriangle, cls: "text-red-500", spin: false, label: "error" },
};

function FunctionDisplay({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const raw = toolCall.name || "tool";
  const meta = STATUS_META[toolCall.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const proj = toolCall.display_projection || {};
  const hideDetails = proj.hide_details && proj.details_redacted;
  let parsedArgs = null;
  try { parsedArgs = JSON.parse(toolCall.arguments_string || "{}"); } catch { parsedArgs = toolCall.arguments_string; }
  let parsedResults = toolCall.results;
  if (typeof parsedResults === "string") { try { parsedResults = JSON.parse(parsedResults); } catch { /* keep raw */ } }
  const failed = toolCall.status === "failed" || toolCall.status === "error" ||
    (typeof parsedResults === "object" && parsedResults && (parsedResults.success === false || /error|failed/i.test(JSON.stringify(parsedResults).slice(0, 200))));
  const labelText = failed ? (proj.error_label || "failed") : meta.label === "completed" || meta.label === "success" ? (proj.label || "done") : (proj.active_label || meta.label);

  if (hideDetails) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${meta.cls} ${meta.spin ? "animate-spin" : ""}`} />
        <span>{proj.label || "tool"} · {labelText}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 text-xs">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-medium text-slate-600">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Icon className={`h-3.5 w-3.5 ${meta.cls} ${meta.spin ? "animate-spin" : ""}`} />
        <Wrench className="h-3.5 w-3.5 text-slate-400" />
        <span className="truncate">{raw}</span>
        <span className={`ml-auto ${failed ? "text-red-500" : meta.cls}`}>· {labelText}</span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-slate-200 px-2.5 py-2">
          <div>
            <p className="mb-1 font-semibold text-slate-500">Parameters:</p>
            <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-700">{JSON.stringify(parsedArgs, null, 2)}</pre>
          </div>
          {parsedResults !== undefined && parsedResults !== null && (
            <div>
              <p className="mb-1 font-semibold text-slate-500">Result:</p>
              <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-700">{typeof parsedResults === "string" ? parsedResults : JSON.stringify(parsedResults, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentMessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        {isUser ? (
          <p className="rounded-2xl rounded-br-sm bg-orange-600 px-4 py-2.5 text-sm text-white">{message.content}</p>
        ) : (
          <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3">
            {message.content && (
              <ReactMarkdown className="prose prose-sm max-w-none text-sm text-slate-800 prose-p:my-1 prose-ul:my-1 prose-li:my-0">{message.content}</ReactMarkdown>
            )}
            {message.tool_calls?.map((tc, idx) => <FunctionDisplay key={idx} toolCall={tc} />)}
          </div>
        )}
      </div>
    </div>
  );
}