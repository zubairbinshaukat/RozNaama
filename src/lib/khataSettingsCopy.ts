import type { Recognition } from '@/lib/khata'

/**
 * Advance & Udhaar settings copy in Roman Urdu, shared by the shop's own
 * Settings sheet and the admin "Shop settings" card so both always match.
 */

export type RecognitionChoice = {
  value:        Recognition
  title:        string
  example:      string
  recommended?: boolean
}

export const KHATA_SETTINGS_COPY = {
  featureName:     'Advance & Udhaar',
  description:     'Customers ka udhaar aur advance ka hisaab rakhein.',
  recommendedTag:  'Behtar',
  advanceLabel:    'Advance sale mein kab gina jaye?',
  udhaarLabel:     'Udhaar sale mein kab gina jaye?',
  footer:          'Tabdeeli sirf nayi entries par lagu hogi.',
  turnedOn:        'Advance & Udhaar on ho gaya',
  turnedOff:       'Advance & Udhaar band ho gaya',
  saved:           'Save ho gaya',
  savedFor:        (name: string) => `${name} ke liye save ho gaya`,
  saveFailed:      'Save nahi hua. Internet check kar ke dobara koshish karein.',
  offline:         'Settings badalne ke liye internet on karein.',
  confirmOffTitle: 'Advance & Udhaar band karein?',
  confirmOffBody:  (open: number, baqi: string) =>
    `Aap ke ${open} khaate abhi khule hain (Baqi ${baqi}). Ye chhup jayenge, delete nahi honge. Dobara on karne par wapas nazar aayenge.`,
  confirmOffAction: 'Band karein',
} as const

export const ADVANCE_CHOICES: readonly RecognitionChoice[] = [
  { value: 'delivery', title: 'Saman dene wale din', example: 'Aaj 5,000 advance, Jumma ko saman diya → sale Jumma ko', recommended: true },
  { value: 'cash',     title: 'Jab paise milein',    example: 'Aaj 5,000 advance mila → aaj ki sale 5,000' },
]

export const UDHAAR_CHOICES: readonly RecognitionChoice[] = [
  { value: 'delivery', title: 'Poori sale usi din',     example: '6,000 ka saman, 3,000 mile → aaj sale 6,000, baqi 3,000', recommended: true },
  { value: 'cash',     title: 'Sirf jo paise milein',   example: 'Aaj 3,000 mile → aaj sale 3,000, baqi milne wale din' },
]
