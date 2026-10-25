const ICON_PATHS = {
  overview: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  details: 'M4 4h16v16H4V4Zm5 0v16m3-11h5m-5 4h5',
  holdings: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  market: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 4 3 14 0 18-3-4-3-14 0-18Z',
  review: 'M9 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-3M9 2h6v5H9V2Zm-1 12 3 3 5-6',
  close: 'm6 6 12 12M6 18 18 6',
  insights: 'M4 3v17h17M8 15l4-5 4 3 5-7',
  research: 'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15',
  sources: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6',
  latest: 'M12 3v3m0 12v3M3 12h3m12 0h3M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 4v4m-2-2h4',
  settings: 'm9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3H9Zm3 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  preferences: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  privacy: 'm12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Zm-3 9 2 2 4-4',
  device: 'M3 4h18v13H3V4Zm5 17h8m-4-4v4',
  import: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
} as const

export type ActionIconName = keyof typeof ICON_PATHS

export function ActionIcon({ name }: { name: ActionIconName }) {
  return <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICON_PATHS[name]} /></svg>
}
