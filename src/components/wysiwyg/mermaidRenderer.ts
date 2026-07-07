import type { Mermaid, MermaidConfig, RenderResult } from 'mermaid';

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  htmlLabels: false,
  themeVariables: {
    background: 'transparent',
    fontFamily:
      'Geist Variable, Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    primaryColor: '#f4f6fb',
    primaryBorderColor: '#9ca3af',
    primaryTextColor: '#111827',
    lineColor: '#64748b',
    secondaryColor: '#eef6ff',
    tertiaryColor: '#fff7ed',
    noteBkgColor: '#fffbeb',
    noteTextColor: '#1f2937',
  },
};

let mermaidPromise: Promise<Mermaid> | null = null;

async function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    });
  }
  return mermaidPromise;
}

export async function renderMermaidDiagramSvg(
  id: string,
  source: string,
): Promise<RenderResult> {
  const mermaid = await getMermaid();
  return mermaid.render(id, source);
}
