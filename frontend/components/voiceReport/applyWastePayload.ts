import {
  findProduceConverter,
  mediumProduceTier,
  mixedPiecesToKg,
  piecesToKg,
  type ProduceSizeCounts,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';

function applyMediumDefault(payload: Record<string, any>, conv: NonNullable<ReturnType<typeof findProduceConverter>>): void {
  const unit = String(payload.unit || '').toLowerCase();
  const pieceLike = !unit || unit === 'szt' || unit === 'op' || unit === 'opak' || unit === 'pcs' || unit === 'pc';
  if (!pieceLike) return;
  const pcs = Number(payload.quantity);
  if (!Number.isFinite(pcs) || pcs <= 0) return;
  const mid = mediumProduceTier(conv);
  const { kg } = piecesToKg(pcs, mid);
  payload.produce_pieces = pcs;
  payload.produce_size_counts = { M: pcs };
  payload.produce_size = `${pcs}×M`;
  payload.produce_converter_id = conv.id;
  payload.quantity = kg;
  payload.unit = 'kg';
}

/**
 * Waste apply: visual size S/M/L → kg.
 * Brak wyboru rozmiaru + sztuki → wzorzec M (np. bakłażan 200 g).
 */
export function applyWasteQuantityToPayload(payload: Record<string, any>): void {
  const conv = findProduceConverter(String(payload.item_name_resolved || payload.item_name || ''));
  const rawCounts = payload.produce_size_counts as ProduceSizeCounts | undefined;
  if (rawCounts && typeof rawCounts === 'object' && conv) {
    const mixed = mixedPiecesToKg(rawCounts, conv);
    if (mixed.pieces > 0 && mixed.kg > 0) {
      payload.produce_pieces = mixed.pieces;
      payload.produce_size_counts = mixed.counts;
      payload.produce_converter_id = conv.id;
      payload.quantity = mixed.kg;
      payload.unit = 'kg';
      return;
    }
  }
  if (payload.produce_size && conv) {
    const pcs = Number(payload.quantity);
    const sizeKey = String(payload.produce_size) as ProduceSizeKey;
    const tier = conv.sizes.find((s) => s.key === sizeKey);
    if (tier && Number.isFinite(pcs) && pcs > 0) {
      const { kg } = piecesToKg(pcs, tier);
      payload.produce_pieces = pcs;
      payload.produce_converter_id = conv.id;
      payload.quantity = kg;
      payload.unit = 'kg';
      return;
    }
  }
  if (conv) applyMediumDefault(payload, conv);
}
