// Connection boundary for external document sources.
// A source is unavailable until credentials and OAuth are explicitly configured.
// Adapters return opaque private storage references; they never imply successful
// government access merely because a customer-facing button exists.

export type DocumentSourceStatus = "AVAILABLE" | "CONNECTION_REQUIRED" | "NOT_CONFIGURED";

export interface ImportedDocument {
  source: string;
  external_document_id: string;
  document_type: string;
  storage_uri: string;
  mime_type: string;
  fetched_at: string;
  provenance: Record<string, unknown>;
}

export interface DocumentSourceAdapter {
  key: string;
  status(): Promise<DocumentSourceStatus>;
  beginConnection?(returnUrl: string): Promise<{ authorization_url: string }>;
  listDocuments?(): Promise<Array<{ id: string; name: string; type?: string }>>;
  importDocument?(externalDocumentId: string): Promise<ImportedDocument>;
}

export function createDigiLockerAdapter(config: { clientId?: string; oauth?: unknown } = {}): DocumentSourceAdapter {
  const configured = Boolean(config.clientId && config.oauth);
  return {
    key: "digilocker",
    async status() { return configured ? "CONNECTION_REQUIRED" : "NOT_CONFIGURED"; },
    async beginConnection() {
      if (!configured) throw Object.assign(new Error("DigiLocker requester credentials are not configured"), { code: "DIGILOCKER_NOT_CONFIGURED" });
      throw Object.assign(new Error("DigiLocker OAuth transport has not been enabled"), { code: "DIGILOCKER_CONNECTION_REQUIRED" });
    },
  };
}
