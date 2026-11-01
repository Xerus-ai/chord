import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown';

describe('markdownToHtml', () => {
  it('emits task lists in the markup the editor parses as to-do items', () => {
    const html = markdownToHtml('- [ ] Review the page\n- [x] Write the plan\n');

    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="false">');
    expect(html).toContain('<li data-type="taskItem" data-checked="true">');
    expect(html).toContain('Review the page');
    expect(html).toContain('Write the plan');
    expect(html).not.toContain('<input');
  });

  it('leaves ordinary bullet lists as plain lists', () => {
    const html = markdownToHtml('- one\n- two\n');

    expect(html).toContain('<ul>');
    expect(html).not.toContain('taskList');
    expect(html).toContain('<li>one</li>');
  });

  it('keeps inline formatting inside a task item', () => {
    const html = markdownToHtml('- [ ] Ship **today**\n');

    expect(html).toContain('<strong>today</strong>');
    expect(html).toContain('data-type="taskItem"');
  });
});
