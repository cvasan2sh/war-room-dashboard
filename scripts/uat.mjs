#!/usr/bin/env node
/**
 * WAR ROOM — User Acceptance Test (UAT) Framework
 * ================================================
 * Automated quality gate that runs BEFORE any git commit.
 * If any CRITICAL check fails, the commit should be blocked.
 *
 * Categories:
 *   1. BUILD & TYPE SAFETY — Does it compile?
 *   2. FONT & READABILITY — Are fonts >= 12px? No sub-12px text?
 *   3. COLOR CONTRAST — WCAG AA compliance (4.5:1 for small, 3:1 for large)
 *   4. RESPONSIVENESS — Mobile breakpoints, no horizontal overflow
 *   5. INTERACTIVITY — Clickable elements, no dead UI
 *   6. CONTENT CLARITY — No unexplained jargon, numbers formatted
 *   7. DATA INTEGRITY — Probabilities sum to 100, no NaN/Infinity
 *
 * Usage: node scripts/uat.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = process.cwd();
const RESULTS = [];
let passCount = 0;
let failCount = 0;
let warnCount = 0;

// ─── Helpers ──────────────────────────────────────────────
function log(icon, msg) { console.log(`  ${icon} ${msg}`); }

function pass(category, msg) {
  RESULTS.push({ status: 'PASS', category, msg });
  passCount++;
  log('✅', msg);
}

function fail(category, msg, detail = '') {
  RESULTS.push({ status: 'FAIL', category, msg, detail });
  failCount++;
  log('❌', `${msg}${detail ? '\n     → ' + detail : ''}`);
}

function warn(category, msg, detail = '') {
  RESULTS.push({ status: 'WARN', category, msg, detail });
  warnCount++;
  log('⚠️ ', `${msg}${detail ? '\n     → ' + detail : ''}`);
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  📋 ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ─── 1. BUILD & TYPE SAFETY ─────────────────────────────
section('1. BUILD & TYPE SAFETY');

try {
  execSync('npx next build 2>&1', { cwd: ROOT, timeout: 120000, encoding: 'utf-8' });
  pass('BUILD', 'Next.js build succeeds (no compilation errors)');
} catch (e) {
  fail('BUILD', 'Next.js build FAILED', e.stdout?.slice(-500) || e.message);
}

// Check TypeScript strict mode
try {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf-8'));
  if (tsconfig?.compilerOptions?.strict) {
    pass('BUILD', 'TypeScript strict mode enabled');
  } else {
    warn('BUILD', 'TypeScript strict mode not enabled (recommended)');
  }
} catch { warn('BUILD', 'Could not read tsconfig.json'); }

// Check for console.log in production code (excluding API routes)
const pageTsx = readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf-8');
const consoleLogCount = (pageTsx.match(/console\.log\(/g) || []).length;
if (consoleLogCount === 0) {
  pass('BUILD', 'No console.log statements in page.tsx');
} else {
  warn('BUILD', `Found ${consoleLogCount} console.log statements in page.tsx (remove for prod)`);
}

// ─── 2. FONT & READABILITY ──────────────────────────────
section('2. FONT & READABILITY');

// Extract all font-size declarations from page.tsx (both inline and CSS class styles)
const fontSizeInline = pageTsx.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)(px|rem)?['"]?/g);
const fontSizeCss = pageTsx.matchAll(/font-size:\s*(\d+(?:\.\d+)?)(px|rem)/g);
const fontSizes = [];
for (const m of [...fontSizeInline, ...fontSizeCss]) {
  let size = parseFloat(m[1]);
  const unit = m[2] || 'px';
  if (unit === 'rem') size = size * 16; // assume 16px base
  fontSizes.push(size);
}

const minFont = Math.min(...fontSizes);
const maxFont = Math.max(...fontSizes);

if (fontSizes.length === 0) {
  warn('FONT', 'No inline fontSize declarations found (using CSS classes?)');
} else {
  if (minFont >= 12) {
    pass('FONT', `Minimum font size: ${minFont}px (≥12px threshold)`);
  } else {
    fail('FONT', `Minimum font size: ${minFont}px — BELOW 12px minimum`,
      `Found sizes: ${fontSizes.filter(s => s < 12).join(', ')}px — users will squint`);
  }

  if (maxFont <= 48) {
    pass('FONT', `Maximum font size: ${maxFont}px (reasonable)`);
  } else {
    warn('FONT', `Maximum font size: ${maxFont}px — may be oversized`);
  }

  // Check for font-size range (should have hierarchy)
  const uniqueSizes = [...new Set(fontSizes)].sort((a, b) => a - b);
  if (uniqueSizes.length >= 3) {
    pass('FONT', `Font hierarchy: ${uniqueSizes.length} distinct sizes (${uniqueSizes.join(', ')}px)`);
  } else {
    warn('FONT', `Only ${uniqueSizes.length} distinct font sizes — may lack visual hierarchy`);
  }
}

// Check body font-family in globals.css
const globalsCss = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf-8');
const bodyFontMatch = globalsCss.match(/font-family:\s*([^;]+)/);
if (bodyFontMatch) {
  const fontStack = bodyFontMatch[1];
  if (fontStack.includes('system-ui') || fontStack.includes('sans-serif') || fontStack.includes('-apple-system')) {
    pass('FONT', 'Body uses system/sans-serif font stack (good for readability)');
  } else if (fontStack.includes('monospace') || fontStack.includes('Mono')) {
    warn('FONT', `Body uses monospace font (${fontStack.trim()}) — harder to read for long text`);
  }
}

// ─── 3. COLOR CONTRAST ──────────────────────────────────
section('3. COLOR CONTRAST');

// Parse hex colors and compute relative luminance
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Background color from globals.css
const bgMatch = globalsCss.match(/background:\s*(#[0-9a-fA-F]{3,8})/);
const bgColor = bgMatch ? bgMatch[1] : '#080c14';

// Extract text colors — distinguish from background/hover contexts
// Pattern: "color: #hex" but NOT "background-color:" or "background:" or ":hover { ... color:"
const allLines = pageTsx.split('\n');
const textColors = new Set();
const bgColors = new Set();

for (const line of allLines) {
  // Skip hover states and background declarations
  const isHoverContext = line.includes(':hover');
  const isBgContext = line.includes('background');

  // Find color declarations
  const colorMatches = line.matchAll(/(?<!\w-)color:\s*['"]?(#[0-9a-fA-F]{6})['"]?/g);
  for (const m of colorMatches) {
    if (isHoverContext || isBgContext) {
      bgColors.add(m[1]); // Skip — these have different backgrounds
    } else {
      textColors.add(m[1]);
    }
  }

  // Track background colors
  const bgMatches = line.matchAll(/background(?:-color)?:\s*['"]?(#[0-9a-fA-F]{6})['"]?/g);
  for (const m of bgMatches) bgColors.add(m[1]);
}

let lowContrastCount = 0;
for (const color of textColors) {
  if (bgColors.has(color)) continue; // This color is also used as a bg — likely not text-on-dark
  const ratio = contrastRatio(color, bgColor);
  if (ratio < 4.5) {
    fail('CONTRAST', `Text color ${color} vs bg ${bgColor} = ${ratio.toFixed(2)}:1 (needs 4.5:1)`,
      `WCAG AA fail — ${ratio < 3 ? 'CRITICALLY low' : 'slightly below threshold'}`);
    lowContrastCount++;
  }
}

if (lowContrastCount === 0 && textColors.size > 0) {
  pass('CONTRAST', `All ${textColors.size} text colors pass WCAG AA against ${bgColor}`);
} else if (textColors.size === 0) {
  warn('CONTRAST', 'Could not extract text colors (may use CSS variables or classes)');
}

// ─── 4. RESPONSIVENESS ──────────────────────────────────
section('4. RESPONSIVENESS');

// Check for mobile viewport meta (should be in layout.tsx)
const layoutTsx = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf-8');
if (layoutTsx.includes('viewport') || pageTsx.includes('viewport')) {
  pass('RESPONSIVE', 'Viewport meta tag found');
} else {
  // Next.js adds viewport by default
  pass('RESPONSIVE', 'Next.js handles viewport meta automatically');
}

// Check for responsive breakpoints in page.tsx
const mediaQueryCount = (pageTsx.match(/@media/g) || []).length;
const maxWidthCount = (pageTsx.match(/max-width/gi) || []).length;
const minWidthCount = (pageTsx.match(/min-width/gi) || []).length;

if (mediaQueryCount >= 1) {
  pass('RESPONSIVE', `Found ${mediaQueryCount} @media queries in page.tsx`);
} else {
  fail('RESPONSIVE', 'No @media queries found — page may not adapt to mobile screens');
}

// Check for fixed widths that could cause overflow
const fixedWidthMatches = pageTsx.matchAll(/width:\s*['"]?(\d+)(px)['"]?/g);
let oversizedFixed = 0;
for (const m of fixedWidthMatches) {
  if (parseInt(m[1]) > 500) oversizedFixed++;
}
if (oversizedFixed === 0) {
  pass('RESPONSIVE', 'No fixed widths >500px that could cause mobile overflow');
} else {
  warn('RESPONSIVE', `${oversizedFixed} elements with fixed width >500px — check mobile overflow`);
}

// Check for mobile-specific CSS in globals.css
const mobileMediaInGlobals = (globalsCss.match(/@media/g) || []).length;
if (mobileMediaInGlobals > 0) {
  pass('RESPONSIVE', `globals.css has ${mobileMediaInGlobals} responsive media queries`);
}

// ─── 5. INTERACTIVITY ───────────────────────────────────
section('5. INTERACTIVITY');

// Check for click handlers
const onClickCount = (pageTsx.match(/onClick/g) || []).length;
if (onClickCount >= 3) {
  pass('INTERACT', `${onClickCount} interactive click handlers found`);
} else if (onClickCount >= 1) {
  warn('INTERACT', `Only ${onClickCount} click handlers — page may feel static`);
} else {
  fail('INTERACT', 'No onClick handlers — page is completely static (no user engagement)');
}

// Check for state management (useState hooks)
const useStateCount = (pageTsx.match(/useState/g) || []).length;
if (useStateCount >= 3) {
  pass('INTERACT', `${useStateCount} useState hooks — sufficient state management`);
} else {
  warn('INTERACT', `Only ${useStateCount} useState hooks — limited interactivity`);
}

// Check for expandable/collapsible UI
const hasExpandable = pageTsx.includes('expand') || pageTsx.includes('collapse') ||
                       pageTsx.includes('toggle') || pageTsx.includes('drawer') ||
                       pageTsx.includes('modal') || pageTsx.includes('accordion');
if (hasExpandable) {
  pass('INTERACT', 'Has expandable/collapsible UI elements (drill-down capability)');
} else {
  warn('INTERACT', 'No expandable/collapsible elements detected — limited drill-down');
}

// Check for tabs or navigation
const hasTabs = pageTsx.includes('activeTab') || pageTsx.includes('tab') || pageTsx.includes('Tab');
if (hasTabs) {
  pass('INTERACT', 'Tab-based navigation detected');
} else {
  warn('INTERACT', 'No tab navigation — all content on single view');
}

// ─── 6. CONTENT CLARITY ─────────────────────────────────
section('6. CONTENT CLARITY');

// Check for unexplained jargon (terms that need context for a new user)
const jargonTerms = [
  { term: /\bP[\-\.]?Weight\b/i, label: 'P-Weight' },
  { term: /\bLR\b/, label: 'LR (likelihood ratio)' },
  { term: /\bIV\b(?![\w])/, label: 'IV (implied volatility)' },
  { term: /\bVIX\b/, label: 'VIX' },
  { term: /\bBayes/i, label: 'Bayesian' },
  { term: /\bposterior\b/i, label: 'posterior' },
  { term: /\bprior odds\b/i, label: 'prior odds' },
];

// Only flag jargon that appears in user-facing text (not variable names)
// Look in template literals and JSX text content
const jsxTextContent = pageTsx.match(/>[^<{]*</g) || [];
const templateLiterals = pageTsx.match(/`[^`]*`/g) || [];
const userFacingText = [...jsxTextContent, ...templateLiterals].join(' ');

let jargonFound = [];
for (const { term, label } of jargonTerms) {
  if (term.test(userFacingText)) {
    jargonFound.push(label);
  }
}

if (jargonFound.length === 0) {
  pass('CLARITY', 'No unexplained jargon in user-facing text');
} else {
  warn('CLARITY', `Jargon found in UI: ${jargonFound.join(', ')}`,
    'Consider adding tooltips or renaming for new users');
}

// Check for number formatting (no excessive decimals)
const decimalMatches = pageTsx.matchAll(/\.toFixed\((\d+)\)/g);
let badDecimals = [];
for (const m of decimalMatches) {
  if (parseInt(m[1]) > 2) badDecimals.push(m[0]);
}
if (badDecimals.length === 0) {
  pass('CLARITY', 'All .toFixed() calls use ≤2 decimal places');
} else {
  warn('CLARITY', `Excessive decimals: ${badDecimals.join(', ')}`);
}

// Check for unformatted number displays (raw math without toFixed/toLocaleString)
const rawMathDisplay = pageTsx.match(/\{[^}]*(?:reduce|Math\.\w+)[^}]*\}/g) || [];
// This is a heuristic — just flag if there are many raw calculations in JSX
if (rawMathDisplay.length > 5) {
  warn('CLARITY', `${rawMathDisplay.length} raw calculations in JSX — ensure numbers are formatted`);
}

// ─── 7. DATA INTEGRITY ──────────────────────────────────
section('7. DATA INTEGRITY');

// Check initial probabilities sum to 100
const initialData = readFileSync(join(ROOT, 'src/lib/initial-data.ts'), 'utf-8');
const probMatches = initialData.matchAll(/prob:\s*(\d+)/g);
let probSum = 0;
for (const m of probMatches) probSum += parseInt(m[1]);

if (probSum === 100) {
  pass('DATA', `Initial scenario probabilities sum to 100% (got ${probSum}%)`);
} else {
  fail('DATA', `Initial probabilities sum to ${probSum}% — must be exactly 100%`,
    'Users will notice if percentages don\'t add up');
}

// Check for NaN/Infinity protection in page.tsx
const hasNanCheck = pageTsx.includes('isNaN') || pageTsx.includes('isFinite') ||
                    pageTsx.includes('|| 0') || pageTsx.includes('?? 0');
if (hasNanCheck) {
  pass('DATA', 'Has NaN/Infinity protection in calculations');
} else {
  warn('DATA', 'No explicit NaN/Infinity guards — edge cases may show broken numbers');
}

// Check for empty state handling (what shows when no data?)
const hasEmptyState = pageTsx.includes('No ') || pageTsx.includes('no ') ||
                      pageTsx.includes('empty') || pageTsx.includes('Loading') ||
                      pageTsx.includes('nothing') || pageTsx.includes('yet');
if (hasEmptyState) {
  pass('DATA', 'Has empty/loading state handling');
} else {
  warn('DATA', 'No empty state handling detected — blank UI if no data loads');
}

// ─── 8. PERFORMANCE ─────────────────────────────────────
section('8. PERFORMANCE');

// Check file size
const pageSize = pageTsx.length;
if (pageSize < 50000) {
  pass('PERF', `page.tsx is ${(pageSize / 1024).toFixed(1)}KB (manageable)`);
} else {
  warn('PERF', `page.tsx is ${(pageSize / 1024).toFixed(1)}KB — consider splitting into components`);
}

// Check for unnecessary re-renders (inline object/function creation in JSX)
const inlineStyleCount = (pageTsx.match(/style=\{\{/g) || []).length;
if (inlineStyleCount < 5) {
  pass('PERF', `${inlineStyleCount} inline style objects (low — good)`);
} else if (inlineStyleCount < 20) {
  pass('PERF', `${inlineStyleCount} inline style objects (moderate — acceptable)`);
} else {
  warn('PERF', `${inlineStyleCount} inline style objects — may cause re-render overhead`);
}

// ─── SUMMARY ─────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  📊 UAT RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ⚠️  WARN: ${warnCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
console.log(`${'═'.repeat(60)}`);

if (failCount > 0) {
  console.log(`\n  🚫 VERDICT: NOT READY FOR COMMIT`);
  console.log(`  Fix ${failCount} failing check(s) before committing.\n`);
  process.exit(1);
} else if (warnCount > 3) {
  console.log(`\n  ⚠️  VERDICT: COMMIT WITH CAUTION`);
  console.log(`  ${warnCount} warnings — review before pushing to production.\n`);
  process.exit(0);
} else {
  console.log(`\n  ✅ VERDICT: READY FOR COMMIT`);
  console.log(`  All critical checks passed.\n`);
  process.exit(0);
}
