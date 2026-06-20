export interface TemplateEntry {
  id:      string
  name:    string
  preview: string // path relative to /public
}

export const PLAN_TEMPLATES: TemplateEntry[] = [
  {
    id:      'formal-gov',
    name:    'Formal Government',
    preview: '/templates/formal-gov-preview.png',
  },
]
