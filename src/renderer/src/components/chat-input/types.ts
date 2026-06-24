import type { AutocompleteItem } from '../../../../shared/types'

export interface AttachedFile {
  name: string
  content: string
  type: string
}

export interface AutocompleteGroup {
  type: AutocompleteItem['type']
  label: string
  items: Array<{ item: AutocompleteItem; index: number }>
}
