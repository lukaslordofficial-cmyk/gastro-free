import React from 'react';
import { Building2, Zap, Users, Package, Trash2, Tag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

export function formatPLN(value: number): string {
  return value.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' PLN';
}

export function getFixedIcon(type: string) {
  switch (type) {
    case 'rent': return <Building2 size={18} color={Colors.accent} strokeWidth={2} />;
    case 'media': return <Zap size={18} color={Colors.warning} strokeWidth={2} />;
    case 'payroll': return <Users size={18} color={Colors.success} strokeWidth={2} />;
    default: return <Tag size={18} color="#7C3AED" strokeWidth={2} />;
  }
}

export function getFixedColor(type: string): string {
  switch (type) {
    case 'rent': return Colors.accentLight;
    case 'media': return Colors.warningLight;
    case 'payroll': return Colors.successLight;
    default: return '#EDE9FE';
  }
}

export function getVarIcon(type: string) {
  switch (type) {
    case 'materials': return <Package size={18} color={Colors.accent} strokeWidth={2} />;
    case 'waste': return <Trash2 size={18} color={Colors.danger} strokeWidth={2} />;
    default: return <Tag size={18} color="#7C3AED" strokeWidth={2} />;
  }
}

export function getVarColor(type: string): string {
  switch (type) {
    case 'materials': return Colors.accentLight;
    case 'waste': return Colors.dangerLight;
    default: return '#EDE9FE';
  }
}
