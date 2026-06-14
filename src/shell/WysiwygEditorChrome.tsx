import { EditorContent, type Editor as TiptapEditor } from '@tiptap/react';

import { LinkPopup } from '@/components/wysiwyg/LinkPopup';
import { SelectionToolbar } from '@/components/wysiwyg/SelectionToolbar';
import { SlashCommandMenu } from '@/components/wysiwyg/SlashCommandMenu';
import { TableToolbar } from '@/components/wysiwyg/TableToolbar';

interface WysiwygEditorChromeProps {
  editor: TiptapEditor | null;
  enabled: boolean;
}

export function WysiwygEditorChrome({ editor, enabled }: WysiwygEditorChromeProps) {
  return (
    <>
      <EditorContent editor={editor} />
      <SlashCommandMenu editor={editor} enabled={enabled} />
      <SelectionToolbar editor={editor} enabled={enabled} />
      <LinkPopup editor={editor} enabled={enabled} />
      <TableToolbar editor={editor} enabled={enabled} />
    </>
  );
}
