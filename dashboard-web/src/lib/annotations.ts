import { pushCloudKey, type StateKey } from './cloudSync';

/**
 * Activity annotations — user-logged events overlaid on charts.
 *
 * Triple Whale's Lighthouse pattern: every time the operator does something
 * meaningful (launches a campaign, raises a price, runs a sale, switches
 * supplier), they log it. Charts then show vertical anchor lines at those
 * dates, so when ROAS spikes or drops a week later, the *cause* is right
 * there in the visualization.
 *
 * Storage: localStorage. Same pattern as billing/insights state.
 */

export type AnnotationKind =
  | 'launch'      // ✨ new campaign / product launch
  | 'pause'       // ⏸ paused something
  | 'budget'      // 💰 budget change
  | 'pricing'     // 💲 price change
  | 'sale'        // 🏷️ promo / sale window
  | 'creative'    // 🎬 new creative / hook
  | 'supplier'    // 🚚 supplier / shipping change
  | 'other';      // 📝 generic note

export type Annotation = {
  id: string;
  date: string;            // YYYY-MM-DD
  kind: AnnotationKind;
  title: string;
  notes?: string;
  /** Optional store scope; null = applies to all stores. */
  store?: string;
  /** ms timestamp at creation, for sort-by-recency in the list. */
  createdAt: number;
};

const STORAGE_KEY: StateKey = 'roas-dashboard:annotations';

export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, string> = {
  launch:    'השקה',
  pause:     'השהיה',
  budget:    'שינוי תקציב',
  pricing:   'שינוי מחיר',
  sale:      'מבצע',
  creative:  'קריאייטיב חדש',
  supplier:  'שינוי ספק',
  other:     'אחר',
};

export const ANNOTATION_KIND_EMOJI: Record<AnnotationKind, string> = {
  launch:    '✨',
  pause:     '⏸',
  budget:    '💰',
  pricing:   '💲',
  sale:      '🏷',
  creative:  '🎬',
  supplier:  '🚚',
  other:     '📝',
};

export const ANNOTATION_KIND_COLOR: Record<AnnotationKind, string> = {
  launch:   'var(--annotation-launch)',
  pause:    'var(--annotation-pause)',
  budget:   'var(--annotation-budget)',
  pricing:  'var(--annotation-pricing)',
  sale:     'var(--annotation-sale)',
  creative: 'var(--annotation-creative)',
  supplier: 'var(--annotation-supplier)',
  other:    'var(--annotation-other)',
};

export function readAnnotations(): Annotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAnnotations(items: Annotation[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('roas-annotations-changed'));
    pushCloudKey(STORAGE_KEY, items);
  } catch {
    /* ignore */
  }
}

export function generateAnnotationId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Filter annotations to the dashboard's current scope. Empty store filter
 * "All" matches everything; a specific store matches both that store's
 * annotations and ones with store=null (global events).
 */
export function annotationsInScope(
  all: Annotation[],
  range: { from: string; to: string },
  store: string,
): Annotation[] {
  return all
    .filter(a => a.date >= range.from && a.date <= range.to)
    .filter(a => store === 'All' || !a.store || a.store === store)
    .sort((a, b) => a.date.localeCompare(b.date));
}
