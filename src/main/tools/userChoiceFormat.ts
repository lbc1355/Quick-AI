import { UserChoiceOption, UserChoiceResponse } from '../../shared/types'

const MAX_USER_CHOICE_OPTIONS = 12

export function cleanToolString(value: unknown, fallback = '', maxLength = 500): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return fallback
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

export function parseUserChoiceOptions(value: unknown): UserChoiceOption[] {
  if (!Array.isArray(value)) return []

  const options: UserChoiceOption[] = []
  for (let i = 0; i < value.length && options.length < MAX_USER_CHOICE_OPTIONS; i++) {
    const item = value[i]
    if (typeof item === 'string') {
      const label = cleanToolString(item, '', 120)
      if (label) {
        options.push({ id: `option-${options.length + 1}`, label, value: label })
      }
      continue
    }

    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const label = cleanToolString(record.label ?? record.name ?? record.title, '', 120)
    if (!label) continue
    const rawValue = record.value ?? record.id ?? label
    const valueText =
      typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
        ? String(rawValue)
        : label
    const description = cleanToolString(record.description ?? record.detail ?? record.hint, '', 240)

    options.push({
      id: `option-${options.length + 1}`,
      label,
      value: valueText,
      ...(description ? { description } : {})
    })
  }

  return options
}

function getSelectedUserChoiceOption(
  response: UserChoiceResponse,
  options: UserChoiceOption[]
): UserChoiceOption | undefined {
  const selectedById = response.selectedOptionId
    ? options.find((option) => option.id === response.selectedOptionId)
    : undefined
  const selectedByValue = response.selectedValue
    ? options.find((option) => option.value === response.selectedValue)
    : undefined
  return selectedById || selectedByValue
}

export function formatUserChoiceResult(
  response: UserChoiceResponse,
  options: UserChoiceOption[]
): string {
  if (response.cancelled) {
    return 'User cancelled the choice request.'
  }

  const selectedOption = getSelectedUserChoiceOption(response, options)
  const label = response.customValue || response.selectedLabel || selectedOption?.label || ''
  const value = response.customValue || response.selectedValue || selectedOption?.value || label

  return [
    'User made a choice.',
    `Selected label: ${label || '(none)'}`,
    `Selected value: ${value || '(none)'}`
  ].join('\n')
}

export function getSelectedUserChoiceLabel(
  response: UserChoiceResponse,
  options: UserChoiceOption[],
  fallback = 'Selection received'
): string {
  return (
    response.customValue ||
    response.selectedLabel ||
    options.find((option) => option.id === response.selectedOptionId)?.label ||
    fallback
  )
}
