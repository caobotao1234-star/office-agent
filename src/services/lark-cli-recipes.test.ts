import { describe, expect, it } from 'vitest';
import { formatLarkCliRecipe, getLarkCliRecipe, listLarkCliRecipes } from './lark-cli-recipes.js';

describe('lark-cli recipes', () => {
  it('provides stable guidance for docs create', () => {
    const recipe = getLarkCliRecipe('docs +create');
    expect(recipe?.examples.join('\n')).toContain('--content -');
    expect(recipe?.pitfalls.join('\n')).toContain('--title');
    expect(formatLarkCliRecipe('docs +create')).toContain('<title>');
  });

  it('provides Base command pitfalls that match known CLI flags', () => {
    expect(formatLarkCliRecipe('base +base-create')).toContain('--name');
    expect(formatLarkCliRecipe('base +base-create')).toContain('不要使用 base +create');
    expect(formatLarkCliRecipe('base +table-create')).toContain('--base-token');
    expect(formatLarkCliRecipe('base +record-batch-create')).toContain('--json');
  });

  it('returns undefined for unknown commands', () => {
    expect(getLarkCliRecipe('unknown +command')).toBeUndefined();
    expect(formatLarkCliRecipe(null)).toBeUndefined();
    expect(listLarkCliRecipes().length).toBeGreaterThan(5);
  });
});
