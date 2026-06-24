import React from 'react'
import type { AutocompleteItem } from '../../../../shared/types'
import {
  getAutocompleteDescription,
  getAutocompleteMeta,
  getAutocompleteTitle
} from '../../utils/autocompleteHelpers'
import type { AutocompleteGroup } from './types'

interface AutocompleteMenuProps {
  groups: AutocompleteGroup[]
  selectedItemIdx: number
  skillsMenuRef: React.RefObject<HTMLDivElement | null>
  onTriggerItem: (item: AutocompleteItem) => void
}

export const AutocompleteMenu: React.FC<AutocompleteMenuProps> = ({
  groups,
  selectedItemIdx,
  skillsMenuRef,
  onTriggerItem
}) => {
  if (groups.length === 0) return null

  return (
    <div ref={skillsMenuRef} className="skills-menu">
      {groups.map((group) => (
        <div key={group.type} className="command-group">
          <div className="command-group-label">{group.label}</div>
          {group.items.map(({ item, index: itemIndex }) => (
            <div
              key={item.id}
              data-autocomplete-index={itemIndex}
              className={`skills-item skills-item-${item.type} ${
                selectedItemIdx === itemIndex ? 'selected' : ''
              }`}
              onClick={() => onTriggerItem(item)}
            >
              <span className="skills-trigger">{item.trigger}</span>
              <span className="skills-name">
                <span className="skills-title">{getAutocompleteTitle(item)}</span>
                <span className="skills-description">{getAutocompleteDescription(item)}</span>
              </span>
              <span className="skills-kind">{getAutocompleteMeta(item)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
