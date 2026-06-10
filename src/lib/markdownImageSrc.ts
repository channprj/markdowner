import { convertFileSrc } from '@tauri-apps/api/core';

const REMOTE_OR_EMBEDDED_SRC = /^(?:https?:|data:|blob:|asset:|customprotocol:)/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;

function splitPathSuffix(src: string): { imagePath: string; suffix: string } {
  const queryIndex = src.indexOf('?');
  const hashIndex = src.indexOf('#');
  const suffixIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (suffixIndex === undefined) {
    return { imagePath: src, suffix: '' };
  }

  return {
    imagePath: src.slice(0, suffixIndex),
    suffix: src.slice(suffixIndex),
  };
}

function decodeFilePath(filePath: string): string {
  try {
    return decodeURI(filePath);
  } catch {
    return filePath;
  }
}

function fileUrlToPath(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== 'file:') {
      return null;
    }

    return decodeFilePath(url.pathname);
  } catch {
    return null;
  }
}

function dirname(filePath: string): string | null {
  const normalized = fileUrlToPath(filePath) ?? filePath;
  const lastSlashIndex = normalized.lastIndexOf('/');

  if (lastSlashIndex < 0) {
    return null;
  }

  if (lastSlashIndex === 0) {
    return '/';
  }

  return normalized.slice(0, lastSlashIndex);
}

function normalizePosixPath(filePath: string): string {
  const isAbsolute = filePath.startsWith('/');
  const parts = filePath.split('/');
  const normalizedParts: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }

    if (part === '..') {
      if (normalizedParts.length > 0 && normalizedParts[normalizedParts.length - 1] !== '..') {
        normalizedParts.pop();
      } else if (!isAbsolute) {
        normalizedParts.push(part);
      }
      continue;
    }

    normalizedParts.push(part);
  }

  const normalized = normalizedParts.join('/');

  if (isAbsolute) {
    return `/${normalized}`;
  }

  return normalized || '.';
}

function isAbsoluteLocalPath(src: string): boolean {
  return src.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(src);
}

export function resolveMarkdownImageSrc(
  src: string | null | undefined,
  activeDocumentPath: string | null | undefined,
): string | undefined {
  if (!src) {
    return src ?? undefined;
  }

  if (
    REMOTE_OR_EMBEDDED_SRC.test(src) ||
    src.startsWith('//') ||
    src.startsWith('#')
  ) {
    return src;
  }

  const { imagePath, suffix } = splitPathSuffix(src);
  const fileUrlPath = fileUrlToPath(imagePath);

  if (fileUrlPath !== null) {
    return `${convertFileSrc(fileUrlPath)}${suffix}`;
  }

  const decodedImagePath = decodeFilePath(imagePath);

  if (isAbsoluteLocalPath(decodedImagePath)) {
    return `${convertFileSrc(decodedImagePath)}${suffix}`;
  }

  const baseDirectory = activeDocumentPath ? dirname(activeDocumentPath) : null;
  if (!baseDirectory) {
    return src;
  }

  const resolvedPath = normalizePosixPath(`${baseDirectory}/${decodedImagePath}`);
  return `${convertFileSrc(resolvedPath)}${suffix}`;
}
