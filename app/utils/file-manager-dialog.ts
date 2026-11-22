import type { InjectionKey } from 'vue'

export interface FileManagerDialogControls {
  close: () => void
  suspend: () => void
  resume: () => void
}

/**
 * What the file manager dialog lets a source tab do to it. `suspend()`
 * closes the dialog but keeps its state and the open tab mounted, and
 * `resume()` shows it again: a `showModal()` dialog sits in the top layer
 * and covers anything appended to `body`, such as Google's Picker, so a tab
 * that opens such a thing suspends the dialog first.
 */
export const FILE_MANAGER_DIALOG_KEY: InjectionKey<FileManagerDialogControls>
  = Symbol('file-manager-dialog')

export const noopFileManagerDialogControls: FileManagerDialogControls = {
  close: () => undefined,
  suspend: () => undefined,
  resume: () => undefined,
}
