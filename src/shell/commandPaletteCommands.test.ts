import { describe, expect, it, vi } from 'vitest';

import type { Settings } from '@/lib/settings';
import { CODE_BLOCK_THEMES, DEFAULT_SETTINGS } from '@/lib/settings';
import {
  buildCommandPaletteCommands,
  type CommandPaletteActions,
} from './commandPaletteCommands';

function actions(overrides: Partial<CommandPaletteActions> = {}): CommandPaletteActions {
  return {
    newDocument: vi.fn(),
    openDocument: vi.fn(),
    openWorkspace: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    exportHtml: vi.fn(),
    exportPdf: vi.fn(),
    exportImage: vi.fn(),
    exportWorkspaceHtml: vi.fn(),
    exportWorkspacePdfs: vi.fn(),
    revealActiveFileInFinder: vi.fn(),
    revealProjectInFinder: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleAiFeature: vi.fn(),
    showExplorerPanel: vi.fn(),
    focusExplorerTree: vi.fn(),
    focusEditor: vi.fn(),
    toggleOutline: vi.fn(),
    openQuickOpen: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    focusSearchPanel: vi.fn(),
    toggleTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    openFindReplace: vi.fn(),
    setMode: vi.fn(),
    updateSettings: vi.fn(),
    openSettings: vi.fn(),
    openKeymap: vi.fn(),
    installCliLauncher: vi.fn(),
    checkForUpdates: vi.fn(),
    installLatestUpdate: vi.fn(),
    openDocumentStats: vi.fn(),
    runAiOnSelection: vi.fn(),
    runLocalAgent: vi.fn(),
    setTheme: vi.fn(),
    followSystemTheme: vi.fn(),
    importTheme: vi.fn(),
    previewCodeBlockTheme: vi.fn(),
    setCodeBlockTheme: vi.fn(),
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

function commandIds(activeDocumentOpen = true) {
  return buildCommandPaletteCommands({
    activeDocumentOpen,
    canGoBack: true,
    canGoForward: true,
    settings: settings(),
    actions: actions(),
  }).map((command) => command.id);
}

describe('buildCommandPaletteCommands', () => {
  it('exposes the AI Feature sidebar toggle with its shortcut', () => {
    const toggleAiFeature = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions({ toggleAiFeature }),
    });

    const command = commands.find((candidate) => candidate.id === 'view.toggleAiFeature');
    expect(command).toMatchObject({
      category: 'View',
      label: 'Toggle AI Feature',
      shortcut: '⌘⇧A',
    });
    command?.run?.();
    expect(toggleAiFeature).toHaveBeenCalledTimes(1);
  });

  it('names the keymap command Show Keyboard Shortcuts (keymap)', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'app.openKeymap')?.label).toBe(
      'Show Keyboard Shortcuts (keymap)',
    );
  });

  it('uses consistent Export as labels', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'file.exportHtml')?.label).toBe(
      'Export as HTML…',
    );
    expect(commands.find((command) => command.id === 'file.exportPdf')?.label).toBe(
      'Export as PDF…',
    );
    expect(commands.find((command) => command.id === 'file.exportImage')?.label).toBe(
      'Export as Image…',
    );
    expect(commands.find((command) => command.id === 'file.exportWorkspaceHtml')?.label).toBe(
      'Export All Markdown as HTML…',
    );
    expect(commands.find((command) => command.id === 'file.exportWorkspacePdfs')?.label).toBe(
      'Export All Markdown as PDFs…',
    );
  });

  it('keeps commands grouped in File, View, Preferences, and Theme order', () => {
    expect(commandIds()).toEqual([
      'file.new',
      'file.open',
      'file.openWorkspace',
      'file.save',
      'file.saveAs',
      'file.exportHtml',
      'file.exportPdf',
      'file.exportImage',
      'file.exportWorkspaceHtml',
      'file.exportWorkspacePdfs',
      'file.revealInFinder',
      'file.revealProjectInFinder',
      'view.toggleSidebar',
      'view.toggleAiFeature',
      'view.showExplorer',
      'view.toggleOutline',
      'view.quickOpen',
      'view.searchInFiles',
      'view.findInFile',
      'view.focusEditor',
      'view.mode.Wysiwyg',
      'view.mode.Editor',
      'view.mode.SplitView',
      'ai.runSelection',
      'ai.runLocalAgent',
      'navigation.back',
      'navigation.forward',
      'terminal.toggle',
      'terminal.focus',
      'terminal.close',
      'preferences.toggleFocusMode',
      'preferences.toggleTypewriterMode',
      'preferences.toggleWordWrap',
      'preferences.toggleWysiwygCodeBlockWrap',
      'preferences.toggleSkillTokenHighlighting',
      'preferences.toggleWordBreakKeepAll',
      'preferences.toggleTableViewMode',
      'preferences.toggleAutoSave',
      'app.settings',
      'app.openKeymap',
      'app.installCliLauncher',
      'app.checkForUpdates',
      'app.installLatestUpdate',
      'app.documentStats',
      'preferences.resetDefaults',
      'theme.light',
      'theme.dark',
      'theme.system',
      'theme.codeBlockTheme',
      'theme.import',
    ]);
  });

  it('disables document-only commands when no document is open', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: false,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'file.save')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'file.saveAs')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'file.exportHtml')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'file.exportPdf')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'file.exportImage')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'file.exportWorkspaceHtml')?.disabled).toBe(
      true,
    );
    expect(commands.find((command) => command.id === 'file.exportWorkspacePdfs')?.disabled).toBe(
      true,
    );
    expect(commands.find((command) => command.id === 'view.findInFile')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'app.documentStats')?.disabled).toBe(true);
    expect(commands.find((command) => command.id === 'ai.runSelection')?.disabled).toBe(
      true,
    );
    expect(commands.find((command) => command.id === 'ai.runLocalAgent')?.disabled).toBe(
      true,
    );
  });

  it('enables AI selection execution only when a non-empty selection exists', () => {
    const runAiOnSelection = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasActiveSelection: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions({ runAiOnSelection }),
    });

    const command = commands.find((candidate) => candidate.id === 'ai.runSelection');
    expect(command?.disabled).toBe(false);
    expect(command?.shortcut).toBe('⌘⇧K');
    command?.run?.();
    expect(runAiOnSelection).toHaveBeenCalledTimes(1);
  });

  it('shows the effective selected-text AI shortcut after rebinding', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasActiveSelection: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({
        keybindingOverrides: { 'ai.runSelection': 'mod+shift+l' },
      }),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'ai.runSelection')?.shortcut).toBe('⌘⇧L');
  });

  it('runs a local agent for any open document, including a collapsed caret', () => {
    const runLocalAgent = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasActiveSelection: false,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions({ runLocalAgent }),
    });

    const command = commands.find((candidate) => candidate.id === 'ai.runLocalAgent');
    expect(command).toMatchObject({
      category: 'AI',
      label: 'Run local agent',
      disabled: false,
    });
    command?.run?.();
    expect(runLocalAgent).toHaveBeenCalledTimes(1);
  });

  it('disables workspace HTML and PDF export without a workspace root', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasWorkspaceRoot: false,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'file.exportWorkspaceHtml')?.disabled).toBe(
      true,
    );
    expect(commands.find((command) => command.id === 'file.exportWorkspacePdfs')?.disabled).toBe(
      true,
    );
  });

  it('wires the export commands to their actions', () => {
    const exportHtml = vi.fn();
    const exportPdf = vi.fn();
    const exportImage = vi.fn();
    const exportWorkspaceHtml = vi.fn();
    const exportWorkspacePdfs = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasWorkspaceRoot: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions({
        exportHtml,
        exportPdf,
        exportImage,
        exportWorkspaceHtml,
        exportWorkspacePdfs,
      }),
    });

    commands.find((command) => command.id === 'file.exportHtml')?.run?.();
    commands.find((command) => command.id === 'file.exportPdf')?.run?.();
    commands.find((command) => command.id === 'file.exportImage')?.run?.();
    commands.find((command) => command.id === 'file.exportWorkspaceHtml')?.run?.();
    commands.find((command) => command.id === 'file.exportWorkspacePdfs')?.run?.();
    expect(exportHtml).toHaveBeenCalledTimes(1);
    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportImage).toHaveBeenCalledTimes(1);
    expect(exportWorkspaceHtml).toHaveBeenCalledTimes(1);
    expect(exportWorkspacePdfs).toHaveBeenCalledTimes(1);
  });

  it('disables the reveal-in-Finder commands without a file path or workspace', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasActiveDocumentPath: false,
      hasWorkspaceRoot: false,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((c) => c.id === 'file.revealInFinder')?.disabled).toBe(true);
    expect(commands.find((c) => c.id === 'file.revealProjectInFinder')?.disabled).toBe(true);
  });

  it('enables and wires the reveal-in-Finder commands when a path and workspace exist', () => {
    const revealActiveFileInFinder = vi.fn();
    const revealProjectInFinder = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      hasActiveDocumentPath: true,
      hasWorkspaceRoot: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions({ revealActiveFileInFinder, revealProjectInFinder }),
    });

    const file = commands.find((c) => c.id === 'file.revealInFinder');
    const project = commands.find((c) => c.id === 'file.revealProjectInFinder');
    expect(file?.disabled).toBe(false);
    expect(project?.disabled).toBe(false);

    file?.run?.();
    project?.run?.();
    expect(revealActiveFileInFinder).toHaveBeenCalledTimes(1);
    expect(revealProjectInFinder).toHaveBeenCalledTimes(1);
  });

  it('disables Back/Forward per canGoBack/canGoForward and wires the actions', () => {
    const navigateBack = vi.fn();
    const navigateForward = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: false,
      settings: settings(),
      actions: actions({ navigateBack, navigateForward }),
    });

    const back = commands.find((command) => command.id === 'navigation.back');
    const forward = commands.find((command) => command.id === 'navigation.forward');
    expect(back?.disabled).toBe(false);
    expect(forward?.disabled).toBe(true);

    back?.run?.();
    forward?.run?.();
    expect(navigateBack).toHaveBeenCalledTimes(1);
    expect(navigateForward).toHaveBeenCalledTimes(1);
  });

  it('derives preference toggle labels and emits updated settings', () => {
    const updateSettings = vi.fn();
    const current = settings({
      autoSave: true,
      editorLineWrap: false,
      wysiwygCodeBlockWrap: false,
      highlightSkillTokens: true,
      editorWordBreakKeepAll: true,
      focusModeEnabled: true,
      typewriterModeEnabled: false,
    });
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: current,
      actions: actions({ updateSettings }),
    });

    expect(commands.find((command) => command.id === 'preferences.toggleFocusMode')?.label)
      .toBe('Disable Focus Mode');
    expect(commands.find((command) => command.id === 'preferences.toggleTypewriterMode')?.label)
      .toBe('Enable Typewriter Mode');
    expect(commands.find((command) => command.id === 'preferences.toggleWordWrap')?.label)
      .toBe('Enable Word Wrap');
    expect(
      commands.find((command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap')?.label,
    ).toBe('Enable WYSIWYG Code Block Wrap');
    expect(
      commands.find((command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap')
        ?.shortcut,
    ).toBeUndefined();
    expect(
      commands.find((command) => command.id === 'preferences.toggleSkillTokenHighlighting')
        ?.label,
    ).toBe('Disable Skill Token Highlighting');
    expect(commands.find((command) => command.id === 'preferences.toggleWordBreakKeepAll')?.label)
      .toBe('Disable Word Break Keep All');
    expect(commands.find((command) => command.id === 'preferences.toggleAutoSave')?.label)
      .toBe('Disable Auto Save to File');

    const enableAutoSave = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: { ...current, autoSave: false },
      actions: actions({ updateSettings }),
    });
    expect(enableAutoSave.find((command) => command.id === 'preferences.toggleAutoSave')?.label)
      .toBe('Enable Auto Save to File');

    commands.find((command) => command.id === 'preferences.toggleWordWrap')?.run?.();
    expect(updateSettings).toHaveBeenCalledWith({
      ...current,
      editorLineWrap: true,
    });

    commands
      .find((command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap')
      ?.run?.();
    expect(updateSettings).toHaveBeenCalledWith({
      ...current,
      wysiwygCodeBlockWrap: true,
    });

    commands
      .find((command) => command.id === 'preferences.toggleSkillTokenHighlighting')
      ?.run?.();
    expect(updateSettings).toHaveBeenCalledWith({
      ...current,
      highlightSkillTokens: false,
    });

    commands.find((command) => command.id === 'preferences.toggleWordBreakKeepAll')?.run?.();
    expect(updateSettings).toHaveBeenCalledWith({
      ...current,
      editorWordBreakKeepAll: false,
    });

    commands.find((command) => command.id === 'preferences.resetDefaults')?.run?.();
    expect(updateSettings).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
  });

  it('labels enabled WYSIWYG code block wrapping by the inverse action', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({ wysiwygCodeBlockWrap: true }),
      actions: actions(),
    });

    expect(
      commands.find((command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap')?.label,
    ).toBe('Disable WYSIWYG Code Block Wrap');
  });

  it('labels disabled skill-token highlighting by the inverse action', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({ highlightSkillTokens: false }),
      actions: actions(),
    });

    expect(
      commands.find((command) => command.id === 'preferences.toggleSkillTokenHighlighting')
        ?.label,
    ).toBe('Enable Skill Token Highlighting');
  });

  it('labels the word-break keep-all toggle by the next action', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({ editorWordBreakKeepAll: false }),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'preferences.toggleWordBreakKeepAll')?.label)
      .toBe('Enable Word Break Keep All');
  });

  it('toggles the table view mode and labels it by the next action', () => {
    const updateSettings = vi.fn();
    const normal = settings({ tableViewMode: 'normal' });
    const normalCommands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: normal,
      actions: actions({ updateSettings }),
    });
    const toggle = normalCommands.find((c) => c.id === 'preferences.toggleTableViewMode');
    expect(toggle?.label).toBe('Table View: Inline (no wrap, scroll)');
    expect(toggle?.shortcut).toBe('⌘⇧M');
    toggle?.run?.();
    expect(updateSettings).toHaveBeenCalledWith({ ...normal, tableViewMode: 'inline' });

    const inlineCommands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({ tableViewMode: 'inline' }),
      actions: actions(),
    });
    expect(inlineCommands.find((c) => c.id === 'preferences.toggleTableViewMode')?.label)
      .toBe('Table View: Normal (wrap)');
  });

  it('exposes shortcuts for the focus-mode and word-wrap toggles', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });
    expect(commands.find((c) => c.id === 'preferences.toggleFocusMode')?.shortcut).toBe('⌘⇧J');
    expect(commands.find((c) => c.id === 'preferences.toggleWordWrap')?.shortcut).toBe('⌥Z');
  });

  it('wires update check and latest-version install commands', () => {
    const checkForUpdates = vi.fn();
    const installLatestUpdate = vi.fn();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      updateAvailable: true,
      latestUpdateVersion: '0.260709.0',
      settings: settings(),
      actions: actions({ checkForUpdates, installLatestUpdate }),
    });

    const check = commands.find((command) => command.id === 'app.checkForUpdates');
    expect(check?.category).toBe('Preferences');
    expect(check?.label).toBe('Check for Updates');
    expect(check?.disabled).toBe(false);
    check?.run?.();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    const install = commands.find((command) => command.id === 'app.installLatestUpdate');
    expect(install?.category).toBe('Preferences');
    expect(install?.label).toBe('Update to Latest Version (v0.260709.0)');
    expect(install?.disabled).toBe(false);
    install?.run?.();
    expect(installLatestUpdate).toHaveBeenCalledTimes(1);
  });

  it('disables update commands while unavailable or busy', () => {
    const unavailable = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      updateAvailable: false,
      settings: settings(),
      actions: actions(),
    });
    expect(unavailable.find((command) => command.id === 'app.installLatestUpdate')?.label)
      .toBe('Update to Latest Version');
    expect(unavailable.find((command) => command.id === 'app.installLatestUpdate')?.disabled)
      .toBe(true);

    const busy = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      updateAvailable: true,
      updateChecking: true,
      updateInstalling: true,
      settings: settings(),
      actions: actions(),
    });
    expect(busy.find((command) => command.id === 'app.checkForUpdates')?.label)
      .toBe('Checking for Updates…');
    expect(busy.find((command) => command.id === 'app.checkForUpdates')?.disabled)
      .toBe(true);
    expect(busy.find((command) => command.id === 'app.installLatestUpdate')?.label)
      .toBe('Installing Latest Version…');
    expect(busy.find((command) => command.id === 'app.installLatestUpdate')?.disabled)
      .toBe(true);
  });

  it('wires editor and terminal commands for the command palette', () => {
    const commandActions = actions();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      terminalOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: commandActions,
    });

    const focusEditor = commands.find((command) => command.id === 'view.focusEditor');
    const toggleTerminal = commands.find((command) => command.id === 'terminal.toggle');
    const focusTerminal = commands.find((command) => command.id === 'terminal.focus');
    const closeTerminal = commands.find((command) => command.id === 'terminal.close');

    expect(focusEditor?.shortcut).toBe('⌥⌘E');
    expect(focusTerminal?.shortcut).toBe('⌥⌘T');
    expect(toggleTerminal?.shortcut).toBe('⌃`');
    expect(closeTerminal?.disabled).toBe(false);

    focusEditor?.run?.();
    toggleTerminal?.run?.();
    focusTerminal?.run?.();
    closeTerminal?.run?.();

    expect(commandActions.focusEditor).toHaveBeenCalledTimes(1);
    expect(commandActions.toggleTerminal).toHaveBeenCalledTimes(1);
    expect(commandActions.focusTerminal).toHaveBeenCalledTimes(1);
    expect(commandActions.closeTerminal).toHaveBeenCalledTimes(1);
  });

  it('disables terminal close when the terminal panel is already closed', () => {
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      terminalOpen: false,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: actions(),
    });

    expect(commands.find((command) => command.id === 'terminal.close')?.disabled).toBe(true);
  });

  it('wires composite and parameterized actions', () => {
    const commandActions = actions();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings(),
      actions: commandActions,
    });

    commands.find((command) => command.id === 'view.showExplorer')?.run?.();
    expect(commandActions.showExplorerPanel).toHaveBeenCalledTimes(1);
    expect(commandActions.focusExplorerTree).toHaveBeenCalledTimes(1);

    commands.find((command) => command.id === 'view.mode.SplitView')?.run?.();
    expect(commandActions.setMode).toHaveBeenCalledWith('SplitView');

    commands.find((command) => command.id === 'theme.light')?.run?.();
    expect(commandActions.setTheme).toHaveBeenCalledWith('BuiltInLight');
  });

  it('exposes a code block theme submenu wired to preview and commit actions', () => {
    const commandActions = actions();
    const commands = buildCommandPaletteCommands({
      activeDocumentOpen: true,
      canGoBack: true,
      canGoForward: true,
      settings: settings({ codeBlockTheme: 'github-dark' }),
      actions: commandActions,
    });

    const opener = commands.find((command) => command.id === 'theme.codeBlockTheme');
    expect(opener?.run).toBeUndefined();
    const submenu = opener?.submenu;
    expect(submenu).toBeDefined();
    // One entry per available theme, highlighting the current selection by default.
    expect(submenu?.items).toHaveLength(CODE_BLOCK_THEMES.length);
    expect(submenu?.initialSelectedId).toBe('cbtheme.github-dark');

    const oneLight = submenu?.items.find((item) => item.id === 'cbtheme.one-light');
    oneLight?.preview?.();
    expect(commandActions.previewCodeBlockTheme).toHaveBeenCalledWith('one-light');
    oneLight?.run?.();
    expect(commandActions.setCodeBlockTheme).toHaveBeenCalledWith('one-light');

    // Leaving the submenu without committing clears the preview.
    submenu?.onCancel?.();
    expect(commandActions.previewCodeBlockTheme).toHaveBeenCalledWith(null);
  });
});
