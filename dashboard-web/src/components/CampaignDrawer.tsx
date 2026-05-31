/**
 * Task 5.5 (Wave 5) — CampaignDrawer was split into 6 sub-tabs under
 * `components/campaign-drawer/`. This shim preserves the existing
 * `@/components/CampaignDrawer` import path so every consumer
 * (CampaignsTable, the bidi.dom test, etc.) keeps working without a
 * cross-tree codemod.
 *
 * The pre-split 1585-line monolith is gone; its content has been
 * re-organised into:
 *   - campaign-drawer/index.tsx              (compound root + shared state)
 *   - campaign-drawer/CampaignDrawerOverview.tsx
 *   - campaign-drawer/CampaignDrawerDaily.tsx
 *   - campaign-drawer/CampaignDrawerAdSets.tsx
 *   - campaign-drawer/CampaignDrawerAds.tsx
 *   - campaign-drawer/CampaignDrawerStatus.tsx
 *   - campaign-drawer/CampaignDrawerHistory.tsx
 *
 * See `campaign-drawer/index.tsx` for the full Q10 hard-cut rationale.
 */

export { CampaignDrawer } from './campaign-drawer';
