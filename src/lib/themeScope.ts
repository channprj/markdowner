export const MARKDOWN_CONTENT_SCOPE_CLASS = 'markdowner-content';

const MARKDOWN_CONTENT_SCOPE_SELECTOR = `.${MARKDOWN_CONTENT_SCOPE_CLASS}`;
const NESTED_SCOPE_AT_RULE_PREFIXES = ['@container', '@document', '@layer', '@media', '@scope', '@supports'];

export function scopeImportedStylesheet(stylesheet: string) {
  return scopeCssBlock(stylesheet, MARKDOWN_CONTENT_SCOPE_SELECTOR);
}

function scopeCssBlock(css: string, scopeSelector: string) {
  let output = '';
  let cursor = 0;

  while (cursor < css.length) {
    cursor = skipTrivia(css, cursor);
    if (cursor >= css.length) {
      break;
    }

    const boundary = findNextBoundary(css, cursor);
    if (boundary === -1) {
      output += css.slice(cursor).trim();
      break;
    }

    const prelude = css.slice(cursor, boundary).trim();
    const boundaryToken = css[boundary];

    if (!prelude) {
      cursor = boundary + 1;
      continue;
    }

    if (boundaryToken === ';') {
      output += `${prelude};`;
      cursor = boundary + 1;
      continue;
    }

    const blockEnd = findMatchingBrace(css, boundary);
    const blockBody = css.slice(boundary + 1, blockEnd);

    if (prelude.startsWith('@')) {
      if (shouldScopeNestedAtRule(prelude)) {
        output += `${prelude}{${scopeCssBlock(blockBody, scopeSelector)}}`;
      } else {
        output += `${prelude}{${blockBody}}`;
      }
    } else {
      output += `${scopeSelectorList(prelude, scopeSelector)}{${blockBody}}`;
    }

    cursor = blockEnd + 1;
  }

  return output;
}

function shouldScopeNestedAtRule(prelude: string) {
  const normalizedPrelude = prelude.toLowerCase();
  return NESTED_SCOPE_AT_RULE_PREFIXES.some((prefix) => normalizedPrelude.startsWith(prefix));
}

function scopeSelectorList(prelude: string, scopeSelector: string) {
  return splitTopLevel(prelude, ',')
    .map((selector) => scopeSelectorFragment(selector, scopeSelector))
    .join(', ');
}

function scopeSelectorFragment(selector: string, scopeSelector: string) {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector || selectorAlreadyScoped(trimmedSelector, scopeSelector)) {
    return trimmedSelector;
  }

  const { selectorWithoutRoot, replacedRoot } = stripLeadingRootSelectors(trimmedSelector);
  const normalizedSelector = selectorWithoutRoot.trim();

  if (!normalizedSelector) {
    return scopeSelector;
  }

  if (replacedRoot && /^[.#:[(]/.test(normalizedSelector)) {
    return `${scopeSelector}${normalizedSelector}`;
  }

  return `${scopeSelector} ${normalizedSelector}`;
}

function selectorAlreadyScoped(selector: string, scopeSelector: string) {
  const escapedScope = escapeForRegex(scopeSelector);
  const scopedSelectorPattern = new RegExp(
    `(^|[\\s>+~,])${escapedScope}(?=($|[\\s>+~.#:\\[]))`,
  );
  return scopedSelectorPattern.test(selector);
}

function stripLeadingRootSelectors(selector: string) {
  let remainingSelector = selector;
  let replacedRoot = false;

  while (true) {
    const leadingRoot = remainingSelector.match(/^(?::root|html|body)(?=($|[\s>+~.#:[(]))/i);
    if (!leadingRoot) {
      return { selectorWithoutRoot: remainingSelector, replacedRoot };
    }

    replacedRoot = true;
    remainingSelector = remainingSelector.slice(leadingRoot[0].length).trimStart();
  }
}

function splitTopLevel(input: string, delimiter: string) {
  const segments: string[] = [];
  let currentSegmentStart = 0;
  let cursor = 0;
  let stringDelimiter: string | null = null;
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  while (cursor < input.length) {
    const current = input[cursor];
    const next = input[cursor + 1];

    if (stringDelimiter) {
      if (current === '\\') {
        cursor += 2;
        continue;
      }
      if (current === stringDelimiter) {
        stringDelimiter = null;
      }
      cursor += 1;
      continue;
    }

    if (current === '"' || current === "'") {
      stringDelimiter = current;
      cursor += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      const commentEnd = input.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? input.length : commentEnd + 2;
      continue;
    }

    if (current === '(') {
      parenthesisDepth += 1;
    } else if (current === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (current === '[') {
      bracketDepth += 1;
    } else if (current === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (
      current === delimiter &&
      parenthesisDepth === 0 &&
      bracketDepth === 0
    ) {
      segments.push(input.slice(currentSegmentStart, cursor));
      currentSegmentStart = cursor + 1;
    }

    cursor += 1;
  }

  segments.push(input.slice(currentSegmentStart));
  return segments.filter((segment) => segment.trim().length > 0);
}

function findNextBoundary(input: string, start: number) {
  let cursor = start;
  let stringDelimiter: string | null = null;
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  while (cursor < input.length) {
    const current = input[cursor];
    const next = input[cursor + 1];

    if (stringDelimiter) {
      if (current === '\\') {
        cursor += 2;
        continue;
      }
      if (current === stringDelimiter) {
        stringDelimiter = null;
      }
      cursor += 1;
      continue;
    }

    if (current === '"' || current === "'") {
      stringDelimiter = current;
      cursor += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      const commentEnd = input.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? input.length : commentEnd + 2;
      continue;
    }

    if (current === '(') {
      parenthesisDepth += 1;
    } else if (current === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (current === '[') {
      bracketDepth += 1;
    } else if (current === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (
      parenthesisDepth === 0 &&
      bracketDepth === 0 &&
      (current === '{' || current === ';')
    ) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

function findMatchingBrace(input: string, openingBraceIndex: number) {
  let cursor = openingBraceIndex;
  let depth = 0;
  let stringDelimiter: string | null = null;

  while (cursor < input.length) {
    const current = input[cursor];
    const next = input[cursor + 1];

    if (stringDelimiter) {
      if (current === '\\') {
        cursor += 2;
        continue;
      }
      if (current === stringDelimiter) {
        stringDelimiter = null;
      }
      cursor += 1;
      continue;
    }

    if (current === '"' || current === "'") {
      stringDelimiter = current;
      cursor += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      const commentEnd = input.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? input.length : commentEnd + 2;
      continue;
    }

    if (current === '{') {
      depth += 1;
    } else if (current === '}') {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }

    cursor += 1;
  }

  return input.length - 1;
}

function skipTrivia(input: string, start: number) {
  let cursor = start;

  while (cursor < input.length) {
    const current = input[cursor];
    const next = input[cursor + 1];

    if (/\s/.test(current)) {
      cursor += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      const commentEnd = input.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? input.length : commentEnd + 2;
      continue;
    }

    break;
  }

  return cursor;
}

function escapeForRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
