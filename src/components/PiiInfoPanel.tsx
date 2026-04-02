import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

const PII_ITEM_KEYS = [
  'pii_item_name',
  'pii_item_dob',
  'pii_item_face',
  'pii_item_address',
  'pii_item_phone',
  'pii_item_email',
  'pii_item_url',
  'pii_item_national_id',
  'pii_item_ahv',
  'pii_item_passport',
  'pii_item_patient',
  'pii_item_bank',
  'pii_item_credit_card',
  'pii_item_health',
]

interface Props {
  title: string
  intro: string
  contextNote: string
  t: (key: string) => string
}

export function PiiInfoPanel({ title, intro, contextNote, t }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="w-full rounded-xl border border-gray-200 overflow-hidden text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <span>{title}</span>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 py-3 bg-white flex flex-col gap-2">
          <p className="text-xs text-gray-600">{intro}</p>
          <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
            {PII_ITEM_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 border-t border-gray-100 pt-2 mt-1">{contextNote}</p>
        </div>
      )}
    </div>
  )
}
