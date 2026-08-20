// Registry of customer-facing policy pages (§16). Each renders at its own URL
// via <PolicyView slug=.../>. Keeping this in one place lets the router, the
// /legal directory and the admin readiness check stay in sync.
export const POLICIES = [
  { slug: 'terms', title: 'Terms & Conditions', path: '/terms', category: 'legal' },
  { slug: 'privacy', title: 'Privacy Policy', path: '/privacy', category: 'legal' },
  { slug: 'refund-policy', title: 'Refund & Cancellation Policy', path: '/refund-policy', category: 'legal' },
  { slug: 'payment-policy', title: 'Payment Policy', path: '/payment-policy', category: 'legal' },
  { slug: 'payment-disputes', title: 'Chargeback & Payment Dispute Policy', path: '/payment-disputes', category: 'legal' },
  { slug: 'cookie-policy', title: 'Cookie Policy', path: '/cookie-policy', category: 'legal' },
  { slug: 'disclaimer', title: 'Disclaimer', path: '/disclaimer', category: 'legal' },
  { slug: 'visa-disclaimer', title: 'Visa Service Disclaimer', path: '/visa-disclaimer', category: 'legal' },
  { slug: 'government-disclaimer', title: 'Government & Embassy Disclaimer', path: '/government-disclaimer', category: 'legal' },
  { slug: 'grievance-policy', title: 'Customer Grievance Policy', path: '/grievance-policy', category: 'legal' },
  { slug: 'complaints', title: 'Complaints Policy', path: '/complaints', category: 'legal' },
  { slug: 'acceptable-use', title: 'Acceptable Use Policy', path: '/acceptable-use', category: 'legal' },
  { slug: 'data-policy', title: 'Data Retention & Deletion Policy', path: '/data-policy', category: 'legal' },
  { slug: 'security', title: 'Security', path: '/security', category: 'trust' },
  { slug: 'accessibility', title: 'Accessibility', path: '/accessibility', category: 'trust' },
  { slug: 'promotional-terms', title: 'Advertising & Promotional Terms', path: '/promotional-terms', category: 'legal' },
  { slug: 'communication-policy', title: 'Communication / SMS / Email Consent', path: '/communication-policy', category: 'legal' },
  { slug: 'third-party-services', title: 'Third-Party Services Disclosure', path: '/third-party-services', category: 'legal' },
  { slug: 'ai-transparency', title: 'How Krosz Uses AI', path: '/ai-transparency', category: 'ai' },
];

export const POLICY_BY_SLUG = Object.fromEntries(POLICIES.map((p) => [p.slug, p]));