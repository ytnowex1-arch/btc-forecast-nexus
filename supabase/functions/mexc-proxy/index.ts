import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bazowy URL dla MEXC Futures Contract V1
const MEXC_BASE = 'https://contract.mexc.com/api/v1/contract';

serve(async (req) => {
  // Obsługa zapytań CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    
    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Brak parametru endpoint' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pobierz wszystkie parametry oprócz 'endpoint'
    const params = new URLSearchParams();
    url.searchParams.forEach((v, k) => {
      if (k !== 'endpoint') params.set(k, v);
    });

    // Budujemy pełny URL do MEXC
    // Ważne: MEXC oczekuje parametrów po znaku zapytania
    const qs = params.toString();
    const mexcUrl = `${MEXC_BASE}/${endpoint}${qs ? '?' + qs : ''}`;

    console.log(`Forwarding request to: ${mexcUrl}`);

    const res = await fetch(mexcUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await res.json();

    // Zwracamy odpowiedź z MEXC bezpośrednio do aplikacji
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`Błąd proxy: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message, success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
