/**
 * Daily cron: alerty wg alert_triggers (domyślnie 7/3/1) + Danie dnia.
 * Deploy: supabase functions deploy expiry-daily-cron
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const lookUntil = new Date(today);
  lookUntil.setDate(lookUntil.getDate() + 14);
  const lookIso = lookUntil.toISOString().slice(0, 10);

  await supabase.rpc("warehouse_inventory_refresh_status").catch(() => null);

  const { data: batches } = await supabase
    .from("warehouse_inventory")
    .select("id,restaurant_id,product_name,quantity,unit,expiration_date,status,alert_triggers")
    .lte("expiration_date", lookIso)
    .gte("expiration_date", todayIso)
    .gt("quantity", 0);

  const alerts: Array<Record<string, unknown>> = [];
  const names: string[] = [];

  for (const b of batches ?? []) {
    const exp = new Date(String(b.expiration_date) + "T00:00:00");
    const daysLeft = Math.max(0, Math.floor((exp.getTime() - today.getTime()) / 86400000));
    const triggers: number[] = Array.isArray(b.alert_triggers) && b.alert_triggers.length
      ? b.alert_triggers.map((x: number) => Number(x))
      : [7, 3, 1];
    if (!triggers.includes(daysLeft) && daysLeft !== 0) continue;

    const message =
      daysLeft === 0
        ? `Produkt ${b.product_name} kończy ważność DZIŚ! Użyj go!`
        : `Produkt ${b.product_name} kończy ważność za ${daysLeft} dni! Użyj go!`;
    console.log("EXPIRY_ALERT", {
      title: "⚠️ Expiration Alert",
      body: `${b.product_name} (Batch: ${b.quantity}) expires in ${daysLeft} days! Consider Dish of the Day.`,
      message,
    });
    names.push(String(b.product_name));
    alerts.push({
      restaurant_id: b.restaurant_id,
      batch_id: b.id,
      product_name: b.product_name,
      days_left: daysLeft,
      alert_day: daysLeft,
      message,
    });
  }

  let dishOfTheDay: string | null = null;
  if (names.length > 0 && OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content:
                "Jesteś szefem kuchni. Na podstawie produktów kończących ważność zaproponuj jedno konkretne „Danie dnia” po polsku (nazwa + 1 zdanie). Odpowiedz samym tekstem.",
            },
            { role: "user", content: `Produkty do wykorzystania: ${names.join(", ")}` },
          ],
        }),
      });
      if (res.ok) {
        const j = await res.json();
        dishOfTheDay = String(j?.choices?.[0]?.message?.content ?? "").trim() || null;
      }
    } catch { /* ignore */ }
  }

  if (alerts.length > 0) {
    const withDish = alerts.map((a, i) =>
      i === 0 ? { ...a, dish_of_the_day: dishOfTheDay } : a,
    );
    await supabase.from("warehouse_expiry_alerts").insert(withDish);

    // Expo Push
    try {
      const { data: tokens } = await supabase.from("device_push_tokens").select("token").limit(500);
      const msgs: Array<Record<string, unknown>> = [];
      for (const t of tokens ?? []) {
        const tok = String(t.token || "").trim();
        if (!tok) continue;
        for (const a of withDish.slice(0, 20)) {
          msgs.push({
            to: tok,
            title: "Termin przydatności",
            body: a.message,
            sound: "default",
            data: { type: "expiry", product_name: a.product_name },
          });
        }
      }
      for (let i = 0; i < msgs.length; i += 80) {
        const chunk = msgs.slice(i, i + 80);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        });
      }
    } catch { /* ignore push errors */ }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      alert_count: alerts.length,
      dish_of_the_day: dishOfTheDay,
      reminders: alerts.map((a) => a.message),
    }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
