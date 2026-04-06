import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const MEXC_BASE = 'https://contract.mexc.com/api/v1/contract';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Missing endpoint param' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Forward query params (except 'endpoint')
    const params = new URLSearchParams();
    url.searchParams.forEach((v, k) => {
      if (k !== 'endpoint') params.set(k, v);
    });
    const qs = params.toString();
    const mexcUrl = `${MEXC_BASE}/${endpoint}${qs ? '?' + qs : ''}`;

    const res = await fetch(mexcUrl);
    const body = await res.text();
    const contentType = res.headers.get('content-type') ?? 'application/json';

    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': contentType },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
