import { readTextFiles } from './desktop';
import { createDocumentTab, generateDocumentTabId, type DocumentTab } from './documentTabs';
import type { DraftBackupEntry } from './draftBackups';

/** Recover drafts even when the tabs file is older, a CLI launch bypasses it,
 * or the original document was removed. Reading files never activates them. */
export async function recoverBackupDocuments(
  tabs: readonly DocumentTab[],
  entries: readonly DraftBackupEntry[],
): Promise<DocumentTab[]> {
  const recovered = [...tabs];
  const handled = new Set<string>();
  for (const entry of entries) {
    if (!entry.path || handled.has(entry.path)) continue;
    handled.add(entry.path);
    const index = recovered.findIndex((tab) => tab.kind === 'document' && tab.path === entry.path);
    if (index >= 0 && !recovered[index].missing) continue;
    const id = index >= 0 ? recovered[index].id : generateDocumentTabId();
    const name = entry.name ?? entry.path.split(/[\\/]/).pop() ?? 'Untitled';
    let tab: DocumentTab;
    try {
      const files = await readTextFiles([entry.path]);
      const file = files.find((file) => file.path === entry.path);
      if (!file) throw new Error('The backed-up file is unavailable');
      tab = createDocumentTab({ id, path: entry.path, name, source: file.contents, draft: entry.draft });
    } catch {
      // Keep the text editable without recreating or overwriting a missing file.
      tab = createDocumentTab({ id, path: null, name: `${name} (Recovered)`, source: '', draft: entry.draft });
    }
    if (index >= 0) recovered[index] = tab;
    else recovered.push(tab);
  }
  return recovered;
}
