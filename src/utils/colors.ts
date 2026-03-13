import type { PiiType } from '../types'

export interface PiiColor {
  bg: string      // Tailwind bg class
  text: string    // Tailwind text class
  border: string  // Tailwind border class
  hex: string     // for canvas/PDF overlay
}

const COLOR_MAP: Record<PiiType, PiiColor> = {
  PERSON:       { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    hex: '#ef4444' },
  ADDRESS:      { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', hex: '#f97316' },
  IBAN:         { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300', hex: '#a855f7' },
  CREDIT_CARD:  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300', hex: '#a855f7' },
  SSN:          { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   hex: '#3b82f6' },
  PASSPORT:     { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   hex: '#3b82f6' },
  ID_NUMBER:    { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   hex: '#3b82f6' },
  EMAIL:        { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-300',  hex: '#22c55e' },
  PHONE:        { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-300',  hex: '#22c55e' },
  DATE_OF_BIRTH:{ bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', hex: '#eab308' },
  IP_ADDRESS:   { bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-300',   hex: '#6b7280' },
  URL:          { bg: 'bg-cyan-100',   text: 'text-cyan-700',   border: 'border-cyan-300',   hex: '#06b6d4' },
  ORG:          { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300', hex: '#6366f1' },
  MISC:         { bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-300',   hex: '#6b7280' },
  HEALTH_DATA:  { bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-300',   hex: '#f43f5e' },
  CONFIDENTIAL: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', hex: '#F26430' },
  PROPRIETARY:  { bg: 'bg-sky-100',    text: 'text-sky-700',    border: 'border-sky-300',    hex: '#009DDC' },
  LEGAL_CLAUSE: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300', hex: '#6761A8' },
}

export function getPiiColor(type: PiiType): PiiColor {
  return COLOR_MAP[type] ?? COLOR_MAP['MISC']
}

export const PII_TYPE_LABELS: Record<PiiType, string> = {
  PERSON:        'Name',
  ADDRESS:       'Address',
  IBAN:          'IBAN',
  CREDIT_CARD:   'Credit Card',
  SSN:           'Social Security No.',
  PASSPORT:      'Passport No.',
  ID_NUMBER:     'ID Number',
  EMAIL:         'Email',
  PHONE:         'Phone',
  DATE_OF_BIRTH: 'Date of Birth',
  IP_ADDRESS:    'IP Address',
  URL:           'Website / URL',
  ORG:           'Organisation',
  MISC:          'Other',
  HEALTH_DATA:   'Health / Clinical Data',
  CONFIDENTIAL:  'Confidential Marking',
  PROPRIETARY:   'Proprietary / IP',
  LEGAL_CLAUSE:  'Legal Clause',
}
