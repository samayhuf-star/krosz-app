// Platform Event Bus — in-process, typed pub/sub.
// Modules communicate through events instead of importing each other.
// This is foundation infrastructure: today it is synchronous/in-process.
// Durable, cross-process delivery will route through Base44 Workflows +
// the Job Engine by dispatching the same event envelope (no API change for
// subscribers). Handlers are isolated — a failing handler never breaks others.

export type PlatformEventType =
  | 'BusinessCreated'
  | 'BlueprintApproved'
  | 'WebsitePublished'
  | 'DomainPurchased'
  | 'SEOApproved'
  | 'SEOGenerated'
  | 'SEOPublished'
  | 'SEOValidated'
  | 'CRMApproved'
  | 'LeadCreated'
  | 'CustomerRegistered'
  | 'AIStageExecuted'
  | 'JobCompleted'
  | 'JobFailed'
  | 'NotificationDispatched'
  | 'KnowledgeGraphStale'
  | 'KnowledgeGraphRebuilt'
  // AI Orchestration Engine
  | 'AIExecutionStarted'
  | 'AIExecutionCompleted'
  | 'AIExecutionFailed'
  | 'AIValidationPassed'
  | 'AIValidationFailed'
  | 'AIFallbackUsed'
  // Communication Hub
  | 'MailboxCreated'
  | 'MailboxDeleted'
  | 'MailboxSynced'
  | 'EmailReceived'
  | 'EmailSent'
  | 'EmailCategorized'
  | 'EmailAssigned'
  | 'EmailReplied'
  | 'EmailSummarized'
  | 'LeadCreatedFromEmail'
  | 'TicketCreatedFromEmail'
  // Worldz Visa (Phase 6) — application question engine
  | 'ApplicationReadinessChanged'
  | 'ApplicationQuestionAnswered'
  | 'ApplicationAnswerChanged'
  // Worldz Visa (Phase 18) — commercial / final-review transitions (§31)
  | 'ApplicationFinalReviewed'
  | 'PriceCalculated'
  | 'OrderCreated'
  | 'PaymentStarted'
  | 'PaymentConfirmed'
  | 'PaymentFailed'
  | 'ApplicationPaid'
  | 'ApplicationReadyForSubmission';

export interface PlatformEvent<T = any> {
  id: string;
  type: PlatformEventType;
  tenantId?: string;
  businessId?: string;
  actor?: string;
  payload: T;
  timestamp: string;
}

type Handler<T = any> = (e: PlatformEvent<T>) => void | Promise<void>;

const handlers = new Map<PlatformEventType | '*', Set<Handler>>();
let sequence = 0;

function uid(): string {
  sequence += 1;
  return `evt_${Date.now()}_${sequence}`;
}

export const bus = {
  subscribe<T = any>(type: PlatformEventType | '*', handler: Handler<T>): () => void {
    const set = handlers.get(type) ?? new Set<Handler>();
    set.add(handler as Handler);
    handlers.set(type, set);
    return () => set.delete(handler as Handler);
  },

  async dispatch<T = any>(type: PlatformEventType, partial: Partial<Omit<PlatformEvent<T>, 'id' | 'type' | 'timestamp'>> & { payload: T }): Promise<void> {
    const event: PlatformEvent<T> = {
      id: uid(),
      type,
      tenantId: partial.tenantId,
      businessId: partial.businessId,
      actor: partial.actor,
      payload: partial.payload,
      timestamp: new Date().toISOString(),
    };
    const targets: Handler[] = [
      ...(handlers.get('*') ?? new Set()),
      ...(handlers.get(type) ?? new Set()),
    ];
    for (const h of targets) {
      try { await h(event); }
      catch (err) {
        // A handler failure is observed but never re-thrown — the bus is fire-and-forget.
        // Logging left to the caller's error pipeline for now.
        void err;
      }
    }
  },

  clear(): void { handlers.clear(); },
  size(type?: PlatformEventType | '*'): number { return handlers.get(type ?? '*')?.size ?? 0; },
};