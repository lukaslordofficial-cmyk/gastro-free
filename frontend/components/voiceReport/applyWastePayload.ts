import {
  findProduceConverter,
  mixedPiecesToKg,
  piecesToKg,
  type ProduceSizeCounts,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';

/**
 * Waste apply: visual size S/M/L → kg for produce counted as pieces.
 * Mutates payload in place (same as previous inline VoiceReportModal logic).
 */
export function applyWasteQuantityToPayload(payload: Record<string, any>): void {
  const rawCounts = payload.produce_size_counts as ProduceSizeCounts | undefined;
  if (rawCounts && typeof rawCounts === 'object') {
    const conv = findProduceConverter(String(payload.item_name || ''));
    if (conv) {
      const mixed = mixedPiecesToKg(rawCounts, conv);
      if (mixed.pieces > 0 && mixed.kg > 0) {
        payload.produce_pieces = mixed.pieces;
        payload.produce_size_counts = mixed.counts;
        payload.produce_converter_id = conv.id;
        payload.quantity = mixed.kg;
        payload.unit = 'kg';
      }
    }
    return;
  }
  if (payload.produce_size) {
    const conv = findProduceConverter(String(payload.item_name || ''));
    const pcs = Number(payload.quantity);
    const sizeKey = String(payload.produce_size) as ProduceSizeKey;
    const tier = conv?.sizes.find((s) => s.key === sizeKey);
    if (conv && tier && Number.isFinite(pcs) && pcs > 0) {
      const { kg } = piecesToKg(pcs, tier);
      payload.produce_pieces = pcs;
      payload.produce_converter_id = conv.id;
      payload.quantity = kg;
      payload.unit = 'kg';
    }
  }
}
