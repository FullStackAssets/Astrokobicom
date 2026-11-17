#!/usr/bin/env node
/**
 * validate-mdx.mjs — compile every post with the real MDX compiler and
 * report every file that would break `next build`.
 *
 * Catches:
 *   - missing/empty frontmatter (a post with no `date` crashes the tag and
 *     sitemap pages: `frontmatter.date.localeCompare` on undefined)
 *   - raw `<` in prose, malformed attributes, unclosed tags, other MDX
 *     syntax errors (via the real compiler)
 *   - JSX components that are not defined by the site (allowlist check)
 *
 * Usage (from a repo root): node scripts/validate-mdx.mjs [content-dir]
 * Prints one line per broken file. Exits 0 when clean, 1 when any file fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileMDX } from 'next-mdx-remote/rsc';

const DEFINED_COMPONENTS = new Set([
  'Callout', 'ProsCons', 'Pros', 'Cons', 'FAQ', 'Question',
  'GearBox', 'GearPick', 'AffiliateDisclosure',
]);

function* walkMdx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMdx(full);
    else if (entry.isFile() && entry.name.endsWith('.mdx')) yield full;
  }
}

function undefinedComponents(source) {
  const bad = new Set();
  for (const m of source.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
    if (!DEFINED_COMPONENTS.has(m[1])) bad.add(m[1]);
  }
  return [...bad];
}

function frontmatterProblems(source) {
  const missing = [];
  if (!source.trim()) return ['empty file'];
  const fm = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return ['no frontmatter block'];
  if (!/^date:\s*\S/m.test(fm[1])) missing.push('no date');
  if (!/^title:\s*\S/m.test(fm[1])) missing.push('no title');
  return missing;
}

const contentDir = process.argv[2] || path.join(process.cwd(), 'content');
const files = [...walkMdx(contentDir)];
let failures = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);
  const fmProblems = frontmatterProblems(source);
  if (fmProblems.length) {
    console.log(`${rel}: MISSING FRONTMATTER: ${fmProblems.join(', ')}`);
    failures++;
    continue;
  }
  const bad = undefinedComponents(source);
  if (bad.length) {
    console.log(`${rel}: UNDEFINED COMPONENT(S): ${bad.join(', ')}`);
    failures++;
    continue;
  }
  try {
    await compileMDX({ source });
  } catch (err) {
    const lines = String(err?.message || err).split('\n').map((l) => l.trim()).filter(Boolean);
    const detail = lines.find((l) => /Unexpected|Expected a closing|Expected component|Could not parse/.test(l)) || lines[1] || lines[0] || 'unknown error';
    console.log(`${rel}: ${detail}`);
    failures++;
  }
}
console.log(`validate-mdx: ${files.length} files, ${failures} broken`);
process.exit(failures ? 1 : 0);
