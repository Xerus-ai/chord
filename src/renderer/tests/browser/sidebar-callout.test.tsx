/**
 * Characterization (devstation-7orh): the sidebar callout was rewritten from a
 * behaviour spec, and the user's acceptance is an identical UI. This records,
 * for every prop shape and both themes, the DOM the callout renders and the
 * computed style of each of its elements in real Chromium with the app's CSS.
 * Layout boxes are left out: they follow the installed fonts, which differ
 * between machines. The snapshot was taken before the rewrite.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarCallout } from '@renderer/features/app-sidebar/sidebar-callout';
import '@renderer/index.css';

const STYLE_PROPERTIES = [
  'display',
  'position',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'background-color',
  'background-image',
  'color',
  'fill',
  'stroke',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'overflow-wrap',
  'word-break',
  'overflow-x',
  'overflow-y',
  'text-overflow',
  'box-shadow',
  'outline-style',
  'cursor',
  'pointer-events',
  'min-width',
  'max-width',
  'transition-property',
  'transition-duration',
] as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  document.documentElement.classList.remove('chord-dark', 'chord-light');
});

const noop = () => {};

const VARIANTS: Record<string, Parameters<typeof SidebarCallout>[0]> = {
  'error with one action (the app sidebar)': {
    variant: 'error',
    title: 'Could not load your work items',
    description: 'connect ECONNREFUSED',
    actions: [{ label: 'Try again', onClick: noop }],
  },
  'default, everything': {
    title: 'Title',
    description: 'Description text',
    icon: <span data-probe-icon>i</span>,
    actions: [
      { label: 'Primary', onClick: noop, variant: 'primary', leading: <span>+</span> },
      { label: 'Secondary', onClick: noop, variant: 'secondary' },
      { label: 'Disabled', onClick: noop, disabled: true },
    ],
    onDismiss: noop,
  },
  'error, everything': {
    variant: 'error',
    title: 'Title',
    description: <em>Rich description</em>,
    icon: <span data-probe-icon>i</span>,
    actions: [
      { label: 'Primary', onClick: noop, variant: 'primary' },
      { label: 'Secondary', onClick: noop, variant: 'secondary', disabled: true },
    ],
    onDismiss: noop,
  },
  'title only': { title: 'Only a title' },
  'description only': { description: 'Only a description' },
  'nothing at all': {},
  'dismiss only': { title: 'Dismissable', onDismiss: noop },
  'actions without title': { actions: [{ label: 'Go', onClick: noop }] },
  'empty actions list': { title: 'Title', actions: [] },
};

function renderCallout(props: Parameters<typeof SidebarCallout>[0]): HTMLElement {
  host = document.createElement('div');
  host.style.width = '260px';
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(<SidebarCallout {...props} />));
  return host;
}

function describeElement(element: Element): unknown {
  const computed = getComputedStyle(element);
  const style = Object.fromEntries(
    STYLE_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)])
  );
  const attributes = Object.fromEntries(
    [...element.attributes].map((attribute) => [attribute.name, attribute.value])
  );
  const text = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join('');
  return {
    tag: element.tagName.toLowerCase(),
    attributes,
    text,
    style,
    children: [...element.children].map(describeElement),
  };
}

describe('SidebarCallout, characterized', () => {
  for (const theme of ['chord-dark', 'chord-light'] as const) {
    for (const [name, props] of Object.entries(VARIANTS)) {
      it(`${theme}: ${name}`, () => {
        document.documentElement.classList.add(theme);
        const rendered = renderCallout(props);

        expect([...rendered.children].map(describeElement)).toMatchSnapshot();
      });
    }
  }

  it('calls each action and the dismiss control with nothing else', () => {
    const calls: string[] = [];
    const rendered = renderCallout({
      title: 'Title',
      actions: [
        { label: 'One', onClick: () => calls.push('one') },
        { label: 'Two', onClick: () => calls.push('two'), disabled: true },
      ],
      onDismiss: () => calls.push('dismiss'),
    });
    const buttons = [...rendered.querySelectorAll('button')];
    for (const button of buttons) button.click();

    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)
    ).toMatchSnapshot();
    expect(calls).toMatchSnapshot();
  });
});
