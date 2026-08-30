// Vercel serverless function: /api/create-web-call
// Creates a single Retell web-call access token server-side, so the
// Retell API key never ships to the browser. The frontend (demo-voice-agent.html)
// calls this endpoint, gets a short-lived accessToken back, and hands that
// token to the Retell Web SDK's startCall().
//
// Requires the RETELL_API_KEY environment variable to be set in the Vercel
// project (Project Settings -> Environment Variables). The Agent ID below is
// not a secret, so it's fine to keep it directly in this file.

const RETELL_AGENT_ID = 'agent_131b6861484f70939886cdc5ce';

module.exports = async (req, res) => {
  // Basic CORS/method guard — this endpoint is only meant to be called from
  // our own demo page via same-origin fetch, but we keep this simple and
  // explicit rather than wide open.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('create-web-call: RETELL_API_KEY is not set in environment variables');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  try {
    const retellRes = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: RETELL_AGENT_ID,
        metadata: { source: 'workartificial-demo-voice-agent' },
      }),
    });

    if (!retellRes.ok) {
      const text = await retellRes.text().catch(() => '');
      console.error('Retell create-web-call failed:', retellRes.status, text);
      res.status(502).json({ error: 'Failed to create call' });
      return;
    }

    const call = await retellRes.json();
    res.status(200).json({ accessToken: call.access_token, callId: call.call_id });
  } catch (err) {
    console.error('create-web-call error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
