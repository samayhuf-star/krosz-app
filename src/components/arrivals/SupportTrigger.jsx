import { useState, useEffect } from "react";
import { MessageCircle, Phone, Video, X } from "lucide-react";

export default function SupportTrigger() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="mb-3 bg-card border border-border rounded-2xl shadow-[0_8px_32px_rgba(20,20,31,0.12)] p-5 w-64">
          <p className="font-semibold text-sm mb-1">Need a hand?</p>
          <p className="text-muted-foreground text-xs mb-4">Our visa experts are available now.</p>
          <div className="space-y-2">
            {[
              { icon: MessageCircle, label: "Chat with an expert" },
              { icon: Phone, label: "Call us: +44 800 123 456" },
              { icon: Video, label: "Book a video call" },
            ].map(({ icon: Icon, label }) => (
              <button key={label} type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-muted transition-colors text-sm text-left">
                <Icon className="w-4 h-4 text-[#FF6B4A]" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)}
        className="w-12 h-12 bg-[#FF6B4A] hover:bg-[#e85a38] text-white rounded-full flex items-center justify-center shadow-lg transition-all">
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>
    </div>
  );
}