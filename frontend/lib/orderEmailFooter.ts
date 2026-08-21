/** Stopka asystenta w szablonie zamówienia (backend `_order_footer`). */

const FOOTER_RE =
  /\n*---\s*Wiadomość wygenerowana automatycznie przez asystenta AI Gastro-Manager[\s\S]*$/i;

export function stripAssistantOrderFooter(body: string): string {
  return (body || '').replace(FOOTER_RE, '').trimEnd();
}

export function withAssistantFooterIfNeeded(
  body: string,
  usesAssistant: boolean,
  footerBody?: string | null,
): string {
  const base = stripAssistantOrderFooter(body);
  if (!usesAssistant) return base;
  const foot = (footerBody || '').trim();
  if (!foot) return body;
  if (FOOTER_RE.test(body)) return body;
  return `${base}\n\n${foot}`;
}
