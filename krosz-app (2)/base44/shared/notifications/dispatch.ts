// Shared Notification Service — one framework every module consumes.
// Modules never send emails / write alerts directly; they call dispatch().
//
// Channels implemented honestly (no fake sends):
//   • in_app  — always: writes a Notification record (the system of record).
//   • email   — real: Resend (team@arrivals.app), reaches any recipient.
// Channels declared but NOT implemented (require a provider/connector to deliver,
// by design not faked): sms, push, webhook, slack, teams. They resolve to
// { delivered: false, reason: 'channel_not_configured' } until a connector is
// authorized. Adding a channel = push an adapter into CHANNELS and wire a connector.

import { bus } from '../events/bus.ts';
import { sendMail as resendSendMail } from '../mail/smtp.ts';

export type Channel = 'in_app' | 'email' | 'sms' | 'push' | 'webhook' | 'slack' | 'teams';
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface DispatchInput {
  tenantId?: string;
  businessId?: string;
  userId: string;            // recipient (registered app user)
  type?: NotificationType;
  title: string;
  body: string;
  channels?: Channel[];     // default ['in_app']
  relatedType?: string;
  relatedId?: string;
  // channel-specific config (e.g. webhook url) — ignored unless an adapter reads it
  channelConfig?: Record<string, any>;
}

export interface DeliveryResult {
  channel: Channel;
  delivered: boolean;
  reason?: string;
}

interface ChannelAdapter {
  deliver(base44: any, input: DispatchInput): Promise<DeliveryResult>;
}

const svc = (base44: any) => base44.asServiceRole ?? base44;

const CHANNELS: Record<Channel, ChannelAdapter> = {
  in_app: {
    async deliver() { return { channel: 'in_app', delivered: true }; }, // the row IS the delivery
  },
  email: {
    async deliver(base44: any, input: DispatchInput): Promise<DeliveryResult> {
      try {
        const user: any = await svc(base44).entities.User.get(input.userId);
        const to = user?.email;
        if (!to) return { channel: 'email', delivered: false, reason: 'recipient_has_no_email' };
        // Resend transactional mail (Arrivals <team@arrivals.app>), not Base44 SendEmail.
        await resendSendMail({ to, subject: input.title, text: input.body });
        return { channel: 'email', delivered: true };
      } catch (e: any) {
        return { channel: 'email', delivered: false, reason: String(e?.message || e) };
      }
    },
  },
  sms: { async deliver() { return { channel: 'sms', delivered: false, reason: 'channel_not_configured' }; } },
  push: { async deliver() { return { channel: 'push', delivered: false, reason: 'channel_not_configured' }; } },
  webhook: { async deliver() { return { channel: 'webhook', delivered: false, reason: 'channel_not_configured' }; } },
  slack: { async deliver() { return { channel: 'slack', delivered: false, reason: 'channel_not_configured' }; } },
  teams: { async deliver() { return { channel: 'teams', delivered: false, reason: 'channel_not_configured' }; } },
};

/**
 * Dispatch a notification across one or more channels.
 * The in-app Notification record (the source of truth) is always written,
 * regardless of channel outcomes. Each channel returns an honest DeliveryResult.
 */
export async function dispatch(base44: any, input: DispatchInput): Promise<{ notificationId: string; deliveries: DeliveryResult[] }> {
  const channels = input.channels && input.channels.length ? input.channels : ['in_app'];
  const deliveries: DeliveryResult[] = [];
  // Run channel deliveries (in_app is a no-op since the row is the delivery).
  for (const ch of channels) {
    const adapter = CHANNELS[ch];
    try { deliveries.push(await adapter.deliver(base44, input)); }
    catch (e: any) { deliveries.push({ channel: ch, delivered: false, reason: String(e?.message || e) }); }
  }
  const rec: any = await svc(base44).entities.Notification.create({
    tenant_id: input.tenantId ?? null,
    business_id: input.businessId ?? null,
    user_id: input.userId,
    type: input.type ?? 'info',
    title: input.title,
    body: input.body,
    channel: channels[0],
    related_type: input.relatedType ?? null,
    related_id: input.relatedId ?? null,
    read: false,
    deliveries,
    occurred_at: new Date().toISOString(),
  });
  await bus.dispatch('NotificationDispatched', { tenantId: input.tenantId, businessId: input.businessId, payload: { notificationId: rec.id, channels } });
  return { notificationId: rec.id, deliveries };
}

export function registerChannel(channel: Channel, adapter: ChannelAdapter): void {
  CHANNELS[channel] = adapter;
}