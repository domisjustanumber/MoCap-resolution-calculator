import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTsFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function extractHtmlIds(htmlPath: string): Set<string> {
  const html = readFileSync(htmlPath, 'utf-8');
  return new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map((m) => m[1]));
}

function extractTsIds(tsFiles: string[]): Set<string> {
  const ids = new Set<string>();

  for (const file of tsFiles) {
    const content = readFileSync(file, 'utf-8');

    // A) document.getElementById('literal')
    for (const m of content.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)) {
      ids.add(m[1]);
    }

    // B) First-arg string IDs: setText, setSpecValue, bindNumberInput,
    //    bindCheckboxInput, bindSelectInput, bindRangeInput, bindQcMotionInput,
    //    syncTargetInput
    for (const m of content.matchAll(
      /\b(setText|setSpecValue|bindNumberInput|bindCheckboxInput|bindSelectInput|bindRangeInput|bindQcMotionInput|syncTargetInput)\(['"]([^'"]+)['"]/g,
    )) {
      ids.add(m[2]);
    }

    // C) First + second arg IDs: bindMotionSlider, setSliderAndInput
    for (const m of content.matchAll(
      /\b(bindMotionSlider|setSliderAndInput)\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]/g,
    )) {
      ids.add(m[2]);
      ids.add(m[3]);
    }

    // D) bindExpBar config objects: trackId, markerId, inputId properties
    for (const m of content.matchAll(/\b(?:trackId|markerId|inputId):\s*['"]([^'"]+)['"]/g)) {
      ids.add(m[1]);
    }

    // E) bindSlider: first arg (id) + third arg (labelId)
    //    bindSlider body uses non-literal parameters, so we extract from call sites.
    //    The second arg is a simple arrow function; brace depth never exceeds 1.
    for (const m of content.matchAll(/bindSlider\('([^']+)'[\s\S]*?},\s*'([^']+)'/g)) {
      ids.add(m[1]);
      ids.add(m[2]);
    }
  }

  return ids;
}

const htmlPath = resolve(__dirname, '..', 'index.html');
const srcDir = resolve(__dirname, '..', 'src');

const htmlIds = extractHtmlIds(htmlPath);
const tsIds = extractTsIds(walkTsFiles(srcDir));

// ---------------------------------------------------------------------------
// Allowlists — documented known mismatches that are not (yet) cleaned up.
// Each entry is a DOM id with a comment explaining the provenance.
// When a mismatch is resolved, remove the id from the allowlist — Test 3/4
// will then fail, requiring the allowlist (and cleanup) to be updated.
// ---------------------------------------------------------------------------

/** IDs referenced in TypeScript but missing from index.html */
const staleJsRefs: string[] = [];

/** IDs in index.html that no TypeScript file looks up by ID */
const layoutOnlyIds: string[] = [
  'temporal-zoom',  // referenced in main.ts via bindSlider with empty labelId; regex captures only first + third args
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DOM binding correctness', () => {
  it('every TS-referenced ID has a matching element in index.html', () => {
    const missing = [...tsIds]
      .filter((id) => !htmlIds.has(id) && !staleJsRefs.includes(id))
      .sort();
    expect(missing).toEqual([]);
  });

  it('every HTML ID is referenced by at least one TS file (or is layout-only)', () => {
    const unreferenced = [...htmlIds]
      .filter((id) => !tsIds.has(id) && !layoutOnlyIds.includes(id))
      .sort();
    expect(unreferenced).toEqual([]);
  });

  it('stale JS allowlist contains only truly-missing IDs', () => {
    const resolved = staleJsRefs.filter((id) => htmlIds.has(id));
    expect(resolved).toEqual([]);
  });

  it('layout-only allowlist contains only truly-unreferenced IDs', () => {
    const referenced = layoutOnlyIds.filter((id) => tsIds.has(id));
    expect(referenced).toEqual([]);
  });
});
