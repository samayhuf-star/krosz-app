import { Play, Webhook, CalendarClock, ShieldCheck, Clock, GitMerge, Square, FileText, Globe, Search, Users, Megaphone, Network, Bot, Plug, Mail, MessageSquare, Circle } from 'lucide-react';

const MAP = {
  Play, Webhook, CalendarClock, ShieldCheck, Clock, GitMerge, Square, FileText, Globe, Search, Users, Megaphone, Network, Bot, Plug, Mail, MessageSquare, Circle,
};

export default function NodeIcon({ name, className = '', size = 16 }) {
  const Cmp = MAP[name] || Circle;
  return <Cmp size={size} className={className} />;
}