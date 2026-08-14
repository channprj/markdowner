import { EditorContent, type Editor as TiptapEditor } from '@tiptap/react';

import { LinkPopup } from '@/components/wysiwyg/LinkPopup';
import { SelectionToolbar } from '@/components/wysiwyg/SelectionToolbar';
import { SlashCommandMenu } from '@/components/wysiwyg/SlashCommandMenu';
import { SkillTokenMenu } from '@/components/wysiwyg/SkillTokenMenu';
import { TableToolbar } from '@/components/wysiwyg/TableToolbar';

interface WysiwygEditorChromeProps {
  editor: TiptapEditor | null;
  enabled: boolean;
  skillNames?: ReadonlySet<string>;
  onAiSelection?: (selection: { from: number; to: number }) => void;
  aiShortcut?: string;
  aiAriaKeyShortcuts?: string;
}

export function WysiwygEditorChrome({
  editor,
  enabled,
  skillNames,
  onAiSelection,
  aiShortcut,
  aiAriaKeyShortcuts,
}: WysiwygEditorChromeProps) {
  return (
    <>
      <EditorContent editor={editor} />
      <SlashCommandMenu
        editor={editor}
        enabled={enabled}
        skillNames={skillNames}
      />
      <SkillTokenMenu
        editor={editor}
        enabled={enabled}
        skillNames={skillNames}
      />
      <SelectionToolbar
        editor={editor}
        enabled={enabled}
        onAiSelection={onAiSelection}
        aiShortcut={aiShortcut}
        aiAriaKeyShortcuts={aiAriaKeyShortcuts}
      />
      <LinkPopup editor={editor} enabled={enabled} />
      <TableToolbar editor={editor} enabled={enabled} />
    </>
  );
}
