import React from 'react';
import { useRouter } from 'expo-router';
import { ProductCascadeModal } from '@/components/premium/ProductCascadeModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';

/** Globalny host modala kaskady produktów (Finanse / Jarvis / Magazyn). */
export function ProductCascadeHost() {
  const { cascade, closeProductCascade } = useUiOverlay();
  const router = useRouter();

  return (
    <ProductCascadeModal
      visible={cascade.visible}
      title={cascade.title}
      subtitle={cascade.subtitle}
      items={cascade.items}
      onClose={closeProductCascade}
      onSelect={(item) => {
        closeProductCascade();
        router.push({
          pathname: '/(tabs)/magazyn',
          params: { focusProductId: item.id, focusProductName: item.name },
        });
      }}
    />
  );
}
