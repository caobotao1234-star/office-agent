import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-')), 'state.json');
}

describe('json-store', () => {
  it('writes and reads JSON atomically', () => {
    const filePath = tmpFile();
    writeJsonFileAtomic(filePath, { items: ['a'] });

    const parsed = readJsonFile(filePath, z.object({ items: z.array(z.string()) }), { fallback: { items: [] } });
    expect(parsed.items).toEqual(['a']);
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('backs up corrupt files and returns fallback', () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, '{ bad json', 'utf-8');

    const parsed = readJsonFile(filePath, z.object({ items: z.array(z.string()) }), { fallback: { items: [] } });
    expect(parsed.items).toEqual([]);
    const backups = fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.corrupt-'));
    expect(backups).toHaveLength(1);
  });
});
