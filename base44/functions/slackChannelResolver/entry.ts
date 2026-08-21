import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("slackbot");

    const channels = [];
    let cursor = "";
    for (let i = 0; i < 50; i++) {
      const url = new URL("https://slack.com/api/conversations.list");
      url.searchParams.set("types", "public_channel,private_channel");
      url.searchParams.set("limit", "200");
      url.searchParams.set("exclude_archived", "true");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (!data.ok) return Response.json({ error: data.error || "slack_error" }, { status: 502 });
      for (const c of (data.channels || [])) {
        if (c.is_im || c.is_mpim) continue;
        channels.push({ id: c.id, name: c.name, is_private: !!c.is_private, is_channel: !!c.is_channel, num_members: c.num_members });
      }
      if (!data.response_metadata?.next_cursor) break;
      cursor = data.response_metadata.next_cursor;
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ channels });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}