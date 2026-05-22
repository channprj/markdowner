export function shouldFocusStartupEditor({
  activeElement,
  documentBody,
  documentElement,
  editorDom,
}: {
  activeElement: Element | null;
  documentBody: HTMLElement | null;
  documentElement: HTMLElement | null;
  editorDom: HTMLElement | null;
}): boolean {
  if (!activeElement) return true;
  if (activeElement === documentBody || activeElement === documentElement) return true;

  return editorDom?.contains(activeElement) ?? false;
}
