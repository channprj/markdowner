use std::{collections::VecDeque, path::PathBuf};

use markdowner_core::{FileDialogOptions, MenuDescriptor, WindowDescriptor};

#[derive(Debug, Clone, PartialEq, Eq)]
struct NsWindowHandle(usize);

#[derive(Debug, Default)]
pub(crate) struct AppKitBridge {
    next_file_selections: VecDeque<PathBuf>,
    next_folder_selection: Option<PathBuf>,
    open_panels: Vec<FileDialogOptions>,
    folder_panels: Vec<String>,
    windows: Vec<(NsWindowHandle, String)>,
    installed_menu_commands: Vec<String>,
}

impl AppKitBridge {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn set_next_file_selection(&mut self, path: Option<PathBuf>) {
        if let Some(path) = path {
            self.next_file_selections.push_back(path);
        }
    }

    pub(crate) fn set_next_folder_selection(&mut self, path: Option<PathBuf>) {
        self.next_folder_selection = path;
    }

    pub(crate) fn choose_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf> {
        self.open_panels.push(options.clone());
        self.next_file_selections.pop_front()
    }

    pub(crate) fn choose_folder(&mut self, title: &str) -> Option<PathBuf> {
        self.folder_panels.push(title.to_string());
        self.next_folder_selection.clone()
    }

    pub(crate) fn create_window(&mut self, descriptor: &WindowDescriptor) {
        let handle = NsWindowHandle(self.windows.len() + 1);
        self.windows.push((handle, descriptor.title().to_string()));
    }

    pub(crate) fn install_menu(&mut self, descriptor: &MenuDescriptor) {
        self.installed_menu_commands = descriptor
            .items()
            .iter()
            .map(|item| item.command().to_string())
            .collect();
    }

    #[cfg(test)]
    pub(crate) fn window_titles(&self) -> Vec<String> {
        self.windows
            .iter()
            .map(|(_, title)| title.clone())
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn installed_menu_commands(&self) -> &[String] {
        &self.installed_menu_commands
    }
}
