// dashboard-web/src/lib/__tests__/aiReportRtlDirectives.test.ts
//
// Phase 12.5.x (2026-05-24, operator requirement) — assert the AI prompt
// in `generateAiReport` carries the formatting contract:
//
//   1. Output must be RTL-aligned (Hebrew).
//   2. Hebrew + English inline must be handled gracefully (no line breaks
//      mid-sentence for English words).
//   3. Numbers + currency formatted in a specific way.
//   4. Response must read like a CEO/Board-level executive briefing —
//      Exec Summary → KPIs → Findings → Actions → KPIs to watch.
//
// These are CONTRACT tests: if a future contributor edits the prompt and
// accidentally drops one of the directives, this catches it.

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';

function emptyReport(): string {
  return generateAiReport({
    storeName: 'All',
    storeId: null,
    range: { from: '2026-05-01', to: '2026-05-31' },
    dailyRows: [],
    productRows: [],
    campaignRows: [],
    ordersRows: [],
    adsRows: [],
    productMap: {},
  });
}

describe('aiReport — RTL + executive-briefing directives (Phase 12.5.x)', () => {
  it('includes the RTL formatting block at the top of the AI instruction', () => {
    const md = emptyReport();
    // The section must exist BEFORE the persona section.
    const designIdx = md.indexOf('עיצוב התשובה');
    const personaIdx = md.indexOf('הפרסונה');
    expect(designIdx).toBeGreaterThan(-1);
    expect(personaIdx).toBeGreaterThan(-1);
    expect(designIdx).toBeLessThan(personaIdx);
  });

  it('explicitly instructs RTL alignment and natural Hebrew/English inline', () => {
    const md = emptyReport();
    // RTL directive.
    expect(md).toMatch(/יישור\s+ימין-לשמאל/);
    expect(md).toMatch(/RTL/);
    // Mixed Hebrew/English inline — no line breaks mid-sentence.
    expect(md).toMatch(/Unicode bidi/);
    expect(md).toMatch(/משפט אחד = שורה אחת/);
  });

  it('instructs the AI to format numbers and currency consistently', () => {
    const md = emptyReport();
    expect(md).toMatch(/נקודה עשרונית/);
    expect(md).toMatch(/סימן מטבע/);
  });

  it('explicitly demands executive-briefing level (not chatbot tone)', () => {
    const md = emptyReport();
    expect(md).toMatch(/דוח מנהלים/);
    expect(md).toMatch(/CEO Briefing|Board-level/);
    // No chatbot fluff.
    expect(md).toMatch(/לא chatbot/);
  });

  it('defines the 6-section executive-briefing structure at the end', () => {
    const md = emptyReport();
    expect(md).toMatch(/תקציר מנהלים.*Executive Summary/);
    expect(md).toMatch(/טבלת KPIs ראשיים/);
    expect(md).toMatch(/ממצאים מרכזיים/);
    expect(md).toMatch(/המלצות פעולה.*Action Items/);
    expect(md).toMatch(/KPIs למעקב יומי/);
    expect(md).toMatch(/סיכום קצר/);
  });

  it('forbids common chatbot hedge phrases', () => {
    const md = emptyReport();
    // The prompt should call OUT phrases the AI must NOT use.
    expect(md).toMatch(/אל תכתוב "אני חושב/);
    expect(md).toMatch(/אל תוסיף disclaimers/);
  });
});
