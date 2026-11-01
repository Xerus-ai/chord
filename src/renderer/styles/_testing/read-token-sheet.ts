import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Container } from 'postcss';

/**
 * What a stylesheet declares, independent of how it is written
 * (devstation-7orh): every rule's declarations keyed by its at-rule context and
 * selector, the last declaration of a property winning as it does in the
 * cascade, plus the order in which those contexts first appear. Comments,
 * blank lines, grouping and the order of declarations inside one rule do not
 * show; anything a browser would compute differently does.
 */
export function readTokenSheet(path: string) {
  const root = postcss.parse(readFileSync(path, 'utf8'));
  const contexts: Record<string, Record<string, string>> = {};
  const contextOrder: string[] = [];
  const atRules: string[] = [];

  const contextOf = (node: Container): string => {
    const chain: string[] = [];
    let parent = node.parent;
    while (parent && parent.type === 'atrule') {
      const atRule = parent as AtRule;
      chain.unshift(`@${atRule.name} ${atRule.params.replace(/\s+/g, ' ').trim()}`);
      parent = parent.parent;
    }
    return chain.join(' > ');
  };

  root.walkAtRules((atRule) => {
    if (!atRule.nodes) atRules.push(`@${atRule.name} ${atRule.params.replace(/\s+/g, ' ').trim()}`);
  });
  root.walkRules((rule) => {
    const selector = rule.selectors.map((s) => s.replace(/\s+/g, ' ').trim()).join(', ');
    const at = contextOf(rule);
    const key = at ? `${at} > ${selector}` : selector;
    if (!contexts[key]) {
      contexts[key] = {};
      contextOrder.push(key);
    }
    rule.walkDecls((decl) => {
      if (decl.parent !== rule) return;
      const value = decl.important ? `${decl.value} !important` : decl.value;
      contexts[key][decl.prop] = value.replace(/\s+/g, ' ').trim();
    });
  });
  root.walkAtRules((atRule) => {
    if (!atRule.nodes || atRule.nodes.every((n) => n.type !== 'decl')) return;
    const key = contextOf(atRule as unknown as Container);
    const name = `${key ? `${key} > ` : ''}@${atRule.name} ${atRule.params}`.trim();
    if (!contexts[name]) {
      contexts[name] = {};
      contextOrder.push(name);
    }
    for (const node of atRule.nodes) {
      if (node.type === 'decl') contexts[name][node.prop] = node.value.replace(/\s+/g, ' ').trim();
    }
  });
  return { atRules, contextOrder, contexts };
}
