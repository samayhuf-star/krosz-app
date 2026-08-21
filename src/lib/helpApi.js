import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  try {
    const res = await base44.functions.invoke("helpContent", payload);
    return res?.data ?? res;
  } catch (e) {
    throw e;
  }
}

// Public read-only help content.
export const listArticlesPublic = (category) => invoke({ action: "list-articles", category });
export const getArticlePublic = (slug) => invoke({ action: "get-article", slug });
export const listFaqsPublic = (category) => invoke({ action: "list-faqs", category });
export const searchHelpPublic = (q) => invoke({ action: "search", q });

// Admin-managed (client uses the user token via base44.entities directly).
export const HelpArticle = base44.entities.HelpArticle;
export const HelpFaq = base44.entities.HelpFaq;

export const HELP_CATEGORIES = [
  { key: 'getting-started', label: 'Getting started' },
  { key: 'eligibility', label: 'Eligibility & routes' },
  { key: 'documents', label: 'Documents & passport' },
  { key: 'applications', label: 'Applications' },
  { key: 'payments', label: 'Payments' },
  { key: 'refunds', label: 'Refunds & cancellations' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'status', label: 'Status & tracking' },
  { key: 'account', label: 'Account' },
  { key: 'support', label: 'Support' },
  { key: 'trust', label: 'Trust & safety' },
];

export const categoryLabel = (key) => HELP_CATEGORIES.find((c) => c.key === key)?.label || key;