/**
 * Supabase Edge Function: Vision AI Expiration Date Scanner
 *
 * Deploy:
 *   supabase functions deploy scan-expiration
 *
 * Secrets:
 *   OPENAI_API_KEY
 *   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected)
 *
 * Body (JSON):
 *   {
 *     "image_base64": string,   // raw base64 or data-URL
 *     "quantity": number,
 *     "restaurant_id"?: string,
 *     "unit"?: string
 *   }
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SYSTEM_PROMPT = `You are a precise data extraction agent for a restaurant inventory system. Analyze the provided image of a food product.
Identify:
1. The clean product name (e.g., "Mleko UHT 3.2%").
2. The exact expiration date. Convert any Polish or international date formats (e.g., "Najlepiej spożyć przed: 24.12.2026", "EXP 12/26", "24-LIS-2026") into a standard YYYY-MM-DD format. If only a month/year is visible, set the date to the last day of that month.

Respond strict JSON only.`;

const JSON_SCHEMA = {
  name: "ExpirationScan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["product_name", "expiration_date", "confidence_score"],
    properties: {
      product_name: { type: "string" },
      expiration_date: { type: "string", description: "YYYY-MM-DD" },
      confidence_score: { type: "number" },
    },
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function toDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith("data:")) return imageBase64;
  return `data:image/jpeg;base64,${imageBase64}`;
}

function computeStatus(isoDate: string): "fresh" | "warning" | "expired" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(isoDate + "T00:00:00");
  const diffDays = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 3) return "warning";
  return "fresh";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const imageBase64 = String(body.image_base64 ?? "");
    const quantity = Number(body.quantity);
    const restaurantId = body.restaurant_id ? String(body.restaurant_id) : null;
    const unit = String(body.unit ?? "szt");

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "image_base64 is required" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return new Response(JSON.stringify({ error: "quantity must be > 0" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const dataUrl = toDataUrl(imageBase64);

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract product name and expiration date from this package photo." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      }),
    });

    if (!openaiRes.ok) {
      const errTxt = await openaiRes.text();
      return new Response(JSON.stringify({ error: `OpenAI: ${errTxt}` }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const openaiJson = await openaiRes.json();
    const raw = openaiJson?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const productName = String(parsed.product_name ?? "").trim();
    const expirationDate = String(parsed.expiration_date ?? "").trim();
    const confidence = Number(parsed.confidence_score ?? 0);

    if (!productName || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
      return new Response(JSON.stringify({ error: "Model returned invalid extraction", parsed }), {
        status: 422,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const status = computeStatus(expirationDate);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Soft-match inventory_items by name
    let inventoryItemId: string | null = null;
    const { data: invRows } = await supabase
      .from("inventory_items")
      .select("id,name,quantity")
      .limit(2000);

    const needle = productName.toLowerCase();
    const match = (invRows ?? []).find((r: { name: string }) => {
      const n = (r.name || "").toLowerCase();
      return n === needle || n.includes(needle) || needle.includes(n);
    });
    if (match) {
      inventoryItemId = match.id;
      await supabase
        .from("inventory_items")
        .update({ quantity: Number(match.quantity ?? 0) + quantity })
        .eq("id", match.id);
    }

    const { data: row, error } = await supabase
      .from("warehouse_inventory")
      .insert({
        restaurant_id: restaurantId,
        inventory_item_id: inventoryItemId,
        product_name: productName,
        quantity,
        unit,
        expiration_date: expirationDate,
        status,
        confidence_score: confidence,
        source: "vision_scan_edge",
      })
      .select("*")
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        product_name: productName,
        expiration_date: expirationDate,
        confidence_score: confidence,
        status,
        quantity,
        inventory_item_id: inventoryItemId,
        batch: row,
        message: `Dodano ${quantity} ${unit} · ${productName} (ważne do ${expirationDate})`,
      }),
      { headers: { ...corsHeaders(), "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
