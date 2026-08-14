import type { EditorMode, ThemeKind } from '@/lib/desktop';
import {
  CODE_BLOCK_THEMES,
  DEFAULT_SETTINGS,
  type CodeBlockTheme,
  type Settings,
} from '@/lib/settings';
import { EDITOR_MODE_OPTIONS } from '@/lib/shellDisplay';
import { formatKeyBinding, resolveShellBindings } from '@/lib/keymap';
import type { CommandPaletteCommand } from './CommandPalette';

export type CommandPaletteActions = {
  newDocument: () => void;
  openDocument: () => void;
  openWorkspace: () => void;
  save: () => void;
  saveAs: () => void;
  exportHtml: () => void;
  exportPdf: () => void;
  exportImage: () => void;
  exportWorkspaceHtml: () => void;
  exportWorkspacePdfs: () => void;
  revealActiveFileInFinder: () => void;
  revealProjectInFinder: () => void;
  toggleSidebar: () => void;
  toggleAiFeature: () => void;
  showExplorerPanel: () => void;
  focusExplorerTree: () => void;
  focusEditor: () => void;
  toggleOutline: () => void;
  openQuickOpen: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  focusSearchPanel: () => void;
  toggleTerminal: () => void;
  focusTerminal: () => void;
  closeTerminal: () => void;
  openFindReplace: (replaceMode: boolean) => void;
  setMode: (mode: EditorMode) => void;
  updateSettings: (settings: Settings) => void;
  openSettings: () => void;
  openKeymap: () => void;
  installCliLauncher: () => void;
  checkForUpdates: () => void;
  installLatestUpdate: () => void;
  openDocumentStats: () => void;
  runAiOnSelection: () => void;
  runLocalAgent: () => void;
  setTheme: (themeKind: ThemeKind) => void;
  followSystemTheme: () => void;
  importTheme: () => void;
  /** Live-preview a code block theme without persisting (null clears the preview). */
  previewCodeBlockTheme: (theme: CodeBlockTheme | null) => void;
  /** Commit and persist the selected code block theme. */
  setCodeBlockTheme: (theme: CodeBlockTheme) => void;
};

type BuildCommandPaletteCommandsInput = {
  activeDocumentOpen: boolean;
  /** A saved file path exists (false for unsaved/untitled docs). */
  hasActiveDocumentPath?: boolean;
  /** A workspace/project root folder is open. */
  hasWorkspaceRoot?: boolean;
  hasActiveSelection?: boolean;
  terminalOpen?: boolean;
  updateAvailable?: boolean;
  updateChecking?: boolean;
  updateInstalling?: boolean;
  latestUpdateVersion?: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  settings: Settings;
  actions: CommandPaletteActions;
};

export function buildCommandPaletteCommands(
  input: BuildCommandPaletteCommandsInput,
): CommandPaletteCommand[] {
  const {
    actions,
    activeDocumentOpen,
    hasActiveDocumentPath = false,
    hasWorkspaceRoot = false,
    hasActiveSelection = false,
    terminalOpen = false,
    updateAvailable = false,
    updateChecking = false,
    updateInstalling = false,
    latestUpdateVersion = null,
    canGoBack,
    canGoForward,
    settings,
  } = input;
  const latestUpdateLabel =
    updateInstalling
      ? 'Installing Latest Version…'
      : updateAvailable && latestUpdateVersion
        ? `Update to Latest Version (v${latestUpdateVersion})`
        : 'Update to Latest Version';
  const aiSelectionShortcut = formatKeyBinding(
    resolveShellBindings(settings.keybindingOverrides)['ai.runSelection'],
  );

  return [
    {
      id: 'file.new',
      category: 'File',
      label: 'New Document',
      shortcut: '⌘N',
      run: actions.newDocument,
    },
    {
      id: 'file.open',
      category: 'File',
      label: 'Open File…',
      shortcut: '⌘O',
      run: actions.openDocument,
    },
    {
      id: 'file.openWorkspace',
      category: 'File',
      label: 'Open Workspace…',
      shortcut: '⌘⇧O',
      run: actions.openWorkspace,
    },
    {
      id: 'file.save',
      category: 'File',
      label: 'Save',
      shortcut: '⌘S',
      disabled: !activeDocumentOpen,
      run: actions.save,
    },
    {
      id: 'file.saveAs',
      category: 'File',
      label: 'Save As…',
      shortcut: '⌘⇧S',
      disabled: !activeDocumentOpen,
      run: actions.saveAs,
    },
    {
      id: 'file.exportHtml',
      category: 'File',
      label: 'Export as HTML…',
      disabled: !activeDocumentOpen,
      run: actions.exportHtml,
    },
    {
      id: 'file.exportPdf',
      category: 'File',
      label: 'Export as PDF…',
      disabled: !activeDocumentOpen,
      run: actions.exportPdf,
    },
    {
      id: 'file.exportImage',
      category: 'File',
      label: 'Export as Image…',
      disabled: !activeDocumentOpen,
      run: actions.exportImage,
    },
    {
      id: 'file.exportWorkspaceHtml',
      category: 'File',
      label: 'Export All Markdown as HTML…',
      disabled: !hasWorkspaceRoot,
      run: actions.exportWorkspaceHtml,
    },
    {
      id: 'file.exportWorkspacePdfs',
      category: 'File',
      label: 'Export All Markdown as PDFs…',
      disabled: !hasWorkspaceRoot,
      run: actions.exportWorkspacePdfs,
    },
    {
      id: 'file.revealInFinder',
      category: 'File',
      label: 'Open Current File Location in Finder',
      disabled: !hasActiveDocumentPath,
      run: actions.revealActiveFileInFinder,
    },
    {
      id: 'file.revealProjectInFinder',
      category: 'File',
      label: 'Open Current Project Location in Finder',
      disabled: !hasWorkspaceRoot,
      run: actions.revealProjectInFinder,
    },
    {
      id: 'view.toggleSidebar',
      category: 'View',
      label: 'Toggle Sidebar',
      shortcut: '⌘⇧B',
      run: actions.toggleSidebar,
    },
    {
      id: 'view.toggleAiFeature',
      category: 'View',
      label: 'Toggle AI Feature',
      shortcut: '⌘⇧A',
      run: actions.toggleAiFeature,
    },
    {
      id: 'view.showExplorer',
      category: 'View',
      label: 'Show Explorer',
      shortcut: '⌘⇧E',
      run: () => {
        actions.showExplorerPanel();
        actions.focusExplorerTree();
      },
    },
    {
      id: 'view.toggleOutline',
      category: 'View',
      label: 'Toggle Outline',
      shortcut: '⌘⇧D',
      run: actions.toggleOutline,
    },
    {
      id: 'view.quickOpen',
      category: 'View',
      label: 'Quick Open File…',
      shortcut: '⌘P',
      run: actions.openQuickOpen,
    },
    {
      id: 'view.searchInFiles',
      category: 'View',
      label: 'Search: Find in Files',
      shortcut: '⌘⇧F',
      run: actions.focusSearchPanel,
    },
    {
      id: 'view.findInFile',
      category: 'View',
      label: 'Find in Current File',
      shortcut: '⌘F',
      disabled: !activeDocumentOpen,
      run: () => actions.openFindReplace(false),
    },
    {
      id: 'view.focusEditor',
      category: 'View',
      label: 'Focus Editor',
      shortcut: '⌥⌘E',
      run: actions.focusEditor,
    },
    ...EDITOR_MODE_OPTIONS.map((option) => ({
      id: `view.mode.${option.mode}`,
      category: 'View',
      label: `Mode: ${option.label}`,
      shortcut: option.shortcutSymbol,
      run: () => actions.setMode(option.mode),
    })),
    {
      id: 'ai.runSelection',
      category: 'AI',
      label: 'AI: Run on Selection…',
      shortcut: aiSelectionShortcut,
      disabled: !activeDocumentOpen || !hasActiveSelection,
      run: actions.runAiOnSelection,
    },
    {
      id: 'ai.runLocalAgent',
      category: 'AI',
      label: 'Run local agent',
      disabled: !activeDocumentOpen,
      run: actions.runLocalAgent,
    },
    {
      id: 'navigation.back',
      category: 'Navigation',
      label: 'Back',
      shortcut: '⌘[',
      disabled: !canGoBack,
      run: actions.navigateBack,
    },
    {
      id: 'navigation.forward',
      category: 'Navigation',
      label: 'Forward',
      shortcut: '⌘]',
      disabled: !canGoForward,
      run: actions.navigateForward,
    },
    {
      id: 'terminal.toggle',
      category: 'Terminal',
      label: terminalOpen ? 'Hide Terminal' : 'Show Terminal',
      shortcut: '⌃`',
      run: actions.toggleTerminal,
    },
    {
      id: 'terminal.focus',
      category: 'Terminal',
      label: 'Focus Terminal',
      shortcut: '⌥⌘T',
      run: actions.focusTerminal,
    },
    {
      id: 'terminal.close',
      category: 'Terminal',
      label: 'Close Terminal',
      disabled: !terminalOpen,
      run: actions.closeTerminal,
    },
    {
      id: 'preferences.toggleFocusMode',
      category: 'Preferences',
      label: settings.focusModeEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode',
      shortcut: '⌘⇧J',
      run: () =>
        actions.updateSettings({
          ...settings,
          focusModeEnabled: !settings.focusModeEnabled,
        }),
    },
    {
      id: 'preferences.toggleTypewriterMode',
      category: 'Preferences',
      label: settings.typewriterModeEnabled ? 'Disable Typewriter Mode' : 'Enable Typewriter Mode',
      shortcut: '⌘⇧Y',
      run: () =>
        actions.updateSettings({
          ...settings,
          typewriterModeEnabled: !settings.typewriterModeEnabled,
        }),
    },
    {
      id: 'preferences.toggleWordWrap',
      category: 'Preferences',
      label: settings.editorLineWrap ? 'Disable Word Wrap' : 'Enable Word Wrap',
      shortcut: '⌥Z',
      run: () =>
        actions.updateSettings({
          ...settings,
          editorLineWrap: !settings.editorLineWrap,
        }),
    },
    {
      id: 'preferences.toggleWysiwygCodeBlockWrap',
      category: 'Preferences',
      label: settings.wysiwygCodeBlockWrap
        ? 'Disable WYSIWYG Code Block Wrap'
        : 'Enable WYSIWYG Code Block Wrap',
      run: () =>
        actions.updateSettings({
          ...settings,
          wysiwygCodeBlockWrap: !settings.wysiwygCodeBlockWrap,
        }),
    },
    {
      id: 'preferences.toggleSkillTokenHighlighting',
      category: 'Preferences',
      label: settings.highlightSkillTokens
        ? 'Disable Skill Token Highlighting'
        : 'Enable Skill Token Highlighting',
      run: () =>
        actions.updateSettings({
          ...settings,
          highlightSkillTokens: !settings.highlightSkillTokens,
        }),
    },
    {
      id: 'preferences.toggleWordBreakKeepAll',
      category: 'Preferences',
      label: settings.editorWordBreakKeepAll
        ? 'Disable Word Break Keep All'
        : 'Enable Word Break Keep All',
      run: () =>
        actions.updateSettings({
          ...settings,
          editorWordBreakKeepAll: !settings.editorWordBreakKeepAll,
        }),
    },
    {
      id: 'preferences.toggleTableViewMode',
      category: 'Preferences',
      label:
        settings.tableViewMode === 'inline'
          ? 'Table View: Normal (wrap)'
          : 'Table View: Inline (no wrap, scroll)',
      shortcut: '⌘⇧M',
      run: () =>
        actions.updateSettings({
          ...settings,
          tableViewMode: settings.tableViewMode === 'inline' ? 'normal' : 'inline',
        }),
    },
    {
      id: 'preferences.toggleAutoSave',
      category: 'Preferences',
      label: settings.autoSave ? 'Disable Auto Save to File' : 'Enable Auto Save to File',
      run: () => actions.updateSettings({ ...settings, autoSave: !settings.autoSave }),
    },
    {
      id: 'app.settings',
      category: 'Preferences',
      label: 'Open Settings',
      shortcut: '⌘,',
      run: actions.openSettings,
    },
    {
      id: 'app.openKeymap',
      category: 'Preferences',
      label: 'Show Keyboard Shortcuts (keymap)',
      shortcut: '⌘/',
      run: actions.openKeymap,
    },
    {
      id: 'app.installCliLauncher',
      category: 'Preferences',
      label: 'Install Markdowner in PATH',
      run: actions.installCliLauncher,
    },
    {
      id: 'app.checkForUpdates',
      category: 'Preferences',
      label: updateChecking ? 'Checking for Updates…' : 'Check for Updates',
      disabled: updateChecking,
      run: actions.checkForUpdates,
    },
    {
      id: 'app.installLatestUpdate',
      category: 'Preferences',
      label: latestUpdateLabel,
      disabled: !updateAvailable || updateInstalling,
      run: actions.installLatestUpdate,
    },
    {
      id: 'app.documentStats',
      category: 'Preferences',
      label: 'Open Document Stats',
      shortcut: '⌘⇧I',
      disabled: !activeDocumentOpen,
      run: actions.openDocumentStats,
    },
    {
      id: 'preferences.resetDefaults',
      category: 'Preferences',
      label: 'Reset Settings to Defaults',
      run: () => actions.updateSettings({ ...DEFAULT_SETTINGS }),
    },
    {
      id: 'theme.light',
      category: 'Theme',
      label: 'Theme: Light',
      run: () => actions.setTheme('BuiltInLight'),
    },
    {
      id: 'theme.dark',
      category: 'Theme',
      label: 'Theme: Dark',
      run: () => actions.setTheme('BuiltInDark'),
    },
    {
      id: 'theme.system',
      category: 'Theme',
      label: 'Theme: Follow System',
      run: actions.followSystemTheme,
    },
    {
      id: 'theme.codeBlockTheme',
      category: 'Theme',
      label: 'Change Code Block Theme…',
      submenu: {
        title: 'Code Block Theme',
        placeholder: 'Select a code block theme…',
        initialSelectedId: `cbtheme.${settings.codeBlockTheme}`,
        onCancel: () => actions.previewCodeBlockTheme(null),
        items: CODE_BLOCK_THEMES.map((theme) => ({
          id: `cbtheme.${theme.value}`,
          label: theme.label,
          preview: () => actions.previewCodeBlockTheme(theme.value),
          run: () => actions.setCodeBlockTheme(theme.value),
        })),
      },
    },
    {
      id: 'theme.import',
      category: 'Theme',
      label: 'Import CSS Theme…',
      run: actions.importTheme,
    },
  ];
}
