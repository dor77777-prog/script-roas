// eslint-rules/no-emoji-in-jsx.js
//
// Wave-5 Task 5.10 — chrome surfaces (buttons, labels, alerts, status pills,
// section headers, …) use Lucide icons; emoji is reserved for *editorial*
// decoration that has no Lucide equivalent. This rule fires on JSX text and
// JSX-attribute string literals that contain an emoji and isn't on the
// editorial allowlist.
//
// Allowlist:
//   - 💰 / ✨            — chart annotation pins + chart-axis decorations
//                          (RoasTargetChart pin glyphs, annotation defaults)
//   - 💡                 — text payloads piped into copy-to-clipboard tooltips
//                          (CampaignsTableRow / AdSetTable / AdsDrawer "Tip:" prefix)
//   - ⚠️ / ℹ️           — long-form Hebrew narrative text (aiReport.ts is `.ts`,
//                          not JSX — this rule won't see it; allowlist is
//                          defense in depth)
//   - 🥇 / 🥈 / 🥉      — rank medals (CohortComparisonPanel + ProductCentricView)
//   - 🔗                 — multi-mapping link glyph (Product/CampaignDrawer)
//   - 🏪                 — store glyph (PerStoreCards / ProductsTable / drawer)
//   - ⌘ / ⌥ / ⌃ / ⇧    — Mac modifier key glyphs for shortcut hints
//   - ✓ / ✗             — text-doc checkmark/x inside hint paragraphs (NOT
//                          for chrome status — chrome uses CheckCircle/XCircle
//                          Lucide icons)
//
// Severity is registered at 'warn' (not 'error') so we can iterate on the
// allowlist without breaking the build. Tighten to 'error' once the surface
// is stable.
//
// Skipped paths:
//   - **/__tests__/**, **/*.test.*  — test fixtures often inline emoji
//   - **/api/oauth/**                — server-rendered HTML status pages
//                                      (TikTok OAuth callback uses ❌/✅
//                                      inside <h1> string literals — these
//                                      are not JSX trees)

// Broad emoji regex — covers misc-symbols-and-pictographs, transport,
// supplemental, emoticons, dingbats, regional-indicators, and the misc-tech
// block. Variation-selector (U+FE0F) + ZWJ (U+200D) are deliberately *not*
// in the class (ESLint's no-misleading-character-class warns when combining
// marks live in [...] — they're stripped from input before matching instead).
// Latin & Hebrew + plain punctuation pass through untouched.
const EMOJI_RE =
  /[\u{1F300}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}]/u;

const ALLOWLIST = new Set([
  '💰', '✨', '💡',
  '⚠️', 'ℹ️',
  '🥇', '🥈', '🥉',
  '🔗',
  '🏪',
  '⌘', '⌥', '⌃', '⇧',
  '✓', '✗',
]);

function containsForbiddenEmoji(text) {
  if (typeof text !== 'string') return false;
  if (!EMOJI_RE.test(text)) return false;
  // Strip every allowlisted glyph (including its trailing VS/ZWJ
  // combining marks if present); if any emoji base code-point is
  // still left, it's forbidden.
  let stripped = text;
  for (const ok of ALLOWLIST) {
    stripped = stripped.split(ok).join('');
  }
  return EMOJI_RE.test(stripped);
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid emoji in JSX text / attribute literals (chrome surfaces). Use Lucide icons. Editorial emoji are allowlisted.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (
      filename.includes('/__tests__/') ||
      filename.includes('.test.') ||
      filename.includes('/api/oauth/')
    )
      return {};
    if (!filename.includes('/components/') && !filename.includes('/app/'))
      return {};

    function report(node) {
      context.report({
        node,
        message:
          'Emoji in JSX chrome — use a Lucide icon. Editorial pins/glyphs are allowlisted in no-emoji-in-jsx.js.',
      });
    }

    return {
      JSXText(node) {
        if (containsForbiddenEmoji(node.value)) report(node);
      },
      Literal(node) {
        // Only flag string literals that *live inside* a JSX attribute —
        // plain string constants (object/keys/etc) are out of scope.
        if (
          node.parent &&
          (node.parent.type === 'JSXAttribute' ||
            (node.parent.type === 'JSXExpressionContainer' &&
              node.parent.parent &&
              node.parent.parent.type === 'JSXAttribute')) &&
          containsForbiddenEmoji(node.value)
        ) {
          report(node);
        }
      },
    };
  },
};
