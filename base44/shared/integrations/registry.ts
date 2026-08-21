// Universal Integration Platform — connector catalog (single source of truth).
// The marketplace reads this registry; installing a connector creates an
// IntegrationConnector instance that references a definition_key here.
//
// Adding a connector = adding a row to CONNECTOR_CATALOG. No code changes elsewhere.

export type ConnectorCategory =
  | "crm" | "accounting" | "payment" | "email" | "calendar" | "storage"
  | "social" | "google" | "ads" | "messaging" | "collaboration"
  | "ecommerce" | "finance" | "erp" | "custom";

export type AuthType = "oauth2" | "api_key" | "basic" | "webhook" | "none";
export type SyncStrategy = "manual" | "scheduled" | "webhook" | "incremental";

export interface ConnectorDefinition {
  key: string;
  name: string;
  category: ConnectorCategory;
  auth_type: AuthType;
  capabilities: string[];
  supported_objects: { object: string; fields: string[] }[];
  default_sync_strategy: SyncStrategy;
  installable: boolean;
  version: string;
  description: string;
}

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  // CRM
  { key: "salesforce", name: "Salesforce", category: "crm", auth_type: "oauth2", capabilities: ["sync_contacts", "sync_leads", "sync_pipeline"], supported_objects: [{ object: "contact", fields: ["id", "email", "name"] }, { object: "lead", fields: ["id", "email", "status"] }, { object: "opportunity", fields: ["id", "amount", "stage"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Sync contacts, leads, opportunities into the Knowledge Graph." },
  { key: "hubspot", name: "HubSpot", category: "crm", auth_type: "oauth2", capabilities: ["sync_contacts", "sync_deals", "sync_tickets"], supported_objects: [{ object: "contact", fields: ["id", "email"] }, { object: "deal", fields: ["id", "amount"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Contacts, deals, tickets." },
  { key: "zoho_crm", name: "Zoho CRM", category: "crm", auth_type: "oauth2", capabilities: ["sync_contacts", "sync_leads"], supported_objects: [{ object: "contact", fields: ["id", "email"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Zoho CRM contacts and leads." },
  // Accounting
  { key: "quickbooks", name: "QuickBooks", category: "accounting", auth_type: "oauth2", capabilities: ["sync_invoices", "sync_payments", "sync_expenses"], supported_objects: [{ object: "invoice", fields: ["id", "total"] }, { object: "payment", fields: ["id", "amount"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Invoices, payments, expenses." },
  { key: "xero", name: "Xero", category: "accounting", auth_type: "oauth2", capabilities: ["sync_invoices", "sync_bank"], supported_objects: [{ object: "invoice", fields: ["id", "total"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Invoices and bank transactions." },
  { key: "tally", name: "Tally", category: "accounting", auth_type: "api_key", capabilities: ["sync_vouchers"], supported_objects: [{ object: "voucher", fields: ["id", "amount"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Tally vouchers (architecture)." },
  { key: "sap", name: "SAP", category: "erp", auth_type: "basic", capabilities: ["sync_orders", "sync_inventory"], supported_objects: [{ object: "order", fields: ["id", "total"] }, { object: "material", fields: ["id", "stock"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "SAP orders and inventory (architecture)." },
  // Payment gateways
  { key: "stripe", name: "Stripe", category: "payment", auth_type: "api_key", capabilities: ["sync_charges", "webhook_events", "sync_subscriptions"], supported_objects: [{ object: "charge", fields: ["id", "amount", "status"] }, { object: "subscription", fields: ["id", "status"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Charges, subscriptions, payment webhooks." },
  { key: "razorpay", name: "Razorpay", category: "payment", auth_type: "api_key", capabilities: ["sync_payments", "webhook_events"], supported_objects: [{ object: "payment", fields: ["id", "amount", "status"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Razorpay payments + webhooks." },
  { key: "paypal", name: "PayPal", category: "payment", auth_type: "oauth2", capabilities: ["sync_orders", "webhook_events"], supported_objects: [{ object: "order", fields: ["id", "amount", "status"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "PayPal orders + webhooks." },
  // Email / Calendar / Storage
  { key: "gmail", name: "Gmail", category: "email", auth_type: "oauth2", capabilities: ["sync_messages", "send"], supported_objects: [{ object: "message", fields: ["id", "subject", "from"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "Inbox sync + send." },
  { key: "outlook", name: "Outlook", category: "email", auth_type: "oauth2", capabilities: ["sync_messages", "send"], supported_objects: [{ object: "message", fields: ["id", "subject"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "Outlook mail." },
  { key: "google_calendar", name: "Google Calendar", category: "calendar", auth_type: "oauth2", capabilities: ["sync_events"], supported_objects: [{ object: "event", fields: ["id", "start", "summary"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Calendar events." },
  { key: "google_drive", name: "Google Drive", category: "storage", auth_type: "oauth2", capabilities: ["sync_files"], supported_objects: [{ object: "file", fields: ["id", "name", "modified"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "Drive files." },
  { key: "onedrive", name: "OneDrive", category: "storage", auth_type: "oauth2", capabilities: ["sync_files"], supported_objects: [{ object: "file", fields: ["id", "name"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "OneDrive files." },
  { key: "dropbox", name: "Dropbox", category: "storage", auth_type: "oauth2", capabilities: ["sync_files"], supported_objects: [{ object: "file", fields: ["id", "name"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "Dropbox files." },
  // Social
  { key: "facebook_pages", name: "Facebook Pages", category: "social", auth_type: "oauth2", capabilities: ["sync_posts", "sync_insights"], supported_objects: [{ object: "post", fields: ["id", "message"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Page posts + insights." },
  { key: "instagram", name: "Instagram Business", category: "social", auth_type: "oauth2", capabilities: ["sync_media", "sync_insights"], supported_objects: [{ object: "media", fields: ["id", "caption"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Media + insights." },
  { key: "tiktok", name: "TikTok", category: "social", auth_type: "oauth2", capabilities: ["sync_videos"], supported_objects: [{ object: "video", fields: ["id", "title"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "TikTok videos." },
  // Google
  { key: "google_business_profile", name: "Google Business Profile", category: "google", auth_type: "oauth2", capabilities: ["sync_reviews", "sync_stats"], supported_objects: [{ object: "review", fields: ["id", "rating"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "GBP reviews + stats." },
  { key: "google_analytics", name: "Google Analytics", category: "google", auth_type: "oauth2", capabilities: ["sync_traffic"], supported_objects: [{ object: "traffic", fields: ["date", "sessions", "users"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "GA traffic + goals." },
  { key: "google_search_console", name: "Google Search Console", category: "google", auth_type: "oauth2", capabilities: ["sync_search_stats"], supported_objects: [{ object: "query", fields: ["query", "clicks", "position"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Search performance." },
  // Ads
  { key: "google_ads", name: "Google Ads", category: "ads", auth_type: "oauth2", capabilities: ["sync_campaigns"], supported_objects: [{ object: "campaign", fields: ["id", "spend", "conversions"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Google Ads campaigns." },
  { key: "meta_ads", name: "Meta Ads", category: "ads", auth_type: "oauth2", capabilities: ["sync_campaigns"], supported_objects: [{ object: "campaign", fields: ["id", "spend"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Meta Ads campaigns." },
  // Messaging / Collaboration
  { key: "whatsapp", name: "WhatsApp Business", category: "messaging", auth_type: "api_key", capabilities: ["send", "receive_webhooks"], supported_objects: [{ object: "message", fields: ["id", "from", "text"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "WhatsApp send + inbound webhooks." },
  { key: "slack", name: "Slack", category: "collaboration", auth_type: "oauth2", capabilities: ["send", "receive_events"], supported_objects: [{ object: "message", fields: ["id", "channel", "text"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Slack messages + events." },
  { key: "microsoft_teams", name: "Microsoft Teams", category: "collaboration", auth_type: "oauth2", capabilities: ["send"], supported_objects: [{ object: "message", fields: ["id", "text"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Teams messages." },
  { key: "microsoft_365", name: "Microsoft 365", category: "collaboration", auth_type: "oauth2", capabilities: ["sync_mail", "sync_calendar", "sync_files"], supported_objects: [{ object: "message", fields: ["id", "subject"] }, { object: "event", fields: ["id", "start"] }], default_sync_strategy: "incremental", installable: true, version: "1.0", description: "Microsoft 365 mail/calendar/files." },
  // Ecommerce
  { key: "shopify", name: "Shopify", category: "ecommerce", auth_type: "api_key", capabilities: ["sync_orders", "sync_customers", "sync_products", "webhook_events"], supported_objects: [{ object: "order", fields: ["id", "total", "customer_id"] }, { object: "customer", fields: ["id", "email"] }, { object: "product", fields: ["id", "title"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Orders, customers, products + webhooks." },
  { key: "woocommerce", name: "WooCommerce", category: "ecommerce", auth_type: "basic", capabilities: ["sync_orders", "sync_customers", "webhook_events"], supported_objects: [{ object: "order", fields: ["id", "total"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "WooCommerce orders + webhooks." },
  // Finance
  { key: "finance_manager", name: "Finance Manager (internal)", category: "finance", auth_type: "none", capabilities: ["track_subscriptions", "track_provider_costs", "estimate_profitability"], supported_objects: [{ object: "subscription", fields: ["id", "amount"] }, { object: "cost", fields: ["id", "amount"] }], default_sync_strategy: "scheduled", installable: false, version: "1.0", description: "Internal Finance AI data surface (architecture)." },
  // Custom
  { key: "custom_rest", name: "Custom REST API", category: "custom", auth_type: "api_key", capabilities: ["sync_custom", "webhook_events"], supported_objects: [{ object: "record", fields: ["id", "type"] }], default_sync_strategy: "scheduled", installable: true, version: "1.0", description: "Connect any REST API via a mapping config." },
  { key: "custom_webhook", name: "Custom Webhook", category: "custom", auth_type: "webhook", capabilities: ["receive_webhooks", "trigger_workflows"], supported_objects: [{ object: "event", fields: ["id", "type"] }], default_sync_strategy: "webhook", installable: true, version: "1.0", description: "Receive external webhooks → Knowledge Graph → Observation → Workflow." },
];

export function listCatalog(): ConnectorDefinition[] { return CONNECTOR_CATALOG; }
export function getDefinition(key: string): ConnectorDefinition | null {
  return CONNECTOR_CATALOG.find((c) => c.key === key) || null;
}
export const INSTALLABLE = CONNECTOR_CATALOG.filter((c) => c.installable);