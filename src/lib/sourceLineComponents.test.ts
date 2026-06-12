import { describe, expect, it } from 'vitest';

import {
  createSourceLineComponent,
  sourceLineMarkdownComponents,
} from './sourceLineComponents';

describe('createSourceLineComponent', () => {
  it('maps markdown source positions onto DOM data attributes', () => {
    const Heading = createSourceLineComponent('h2');
    const props = {
      node: {
        position: {
          start: {
            line: 7,
            offset: 42,
          },
          end: {
            offset: 91,
          },
        },
      },
      className: 'headline',
      children: 'Heading',
    };

    const element = Heading(props);

    expect(element.type).toBe('h2');
    expect(element.props).toMatchObject({
      className: 'headline',
      children: 'Heading',
      'data-source-line': 7,
      'data-source-offset': 42,
      'data-source-end-offset': 91,
    });
  });

  it('omits data attributes when source positions are not finite numbers', () => {
    const Paragraph = createSourceLineComponent('p');
    const props = {
      node: {
        position: {
          start: {
            line: Number.NaN,
            offset: Number.POSITIVE_INFINITY,
          },
          end: {
            offset: Number.NEGATIVE_INFINITY,
          },
        },
      },
      children: 'Paragraph',
    };

    const element = Paragraph(props);

    expect(element.props['data-source-line']).toBeUndefined();
    expect(element.props['data-source-offset']).toBeUndefined();
    expect(element.props['data-source-end-offset']).toBeUndefined();
  });
});

describe('sourceLineMarkdownComponents', () => {
  it('covers the preview elements that receive source location metadata', () => {
    expect(Object.keys(sourceLineMarkdownComponents).sort()).toEqual([
      'blockquote',
      'code',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'li',
      'p',
      'pre',
      'table',
      'tr',
    ]);
  });
});
