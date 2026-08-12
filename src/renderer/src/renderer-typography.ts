/** Content renderers deliberately share one code size so terminal and diff text stay aligned. */
export const CONTENT_TYPOGRAPHY = {
  codeFontSize: 13,
  terminalLineHeight: 1.25,
} as const;

/** Spread into each Monaco diff editor so a new diff surface cannot silently drift to 12px. */
export const MONACO_DIFF_TYPOGRAPHY = {
  fontSize: CONTENT_TYPOGRAPHY.codeFontSize,
} as const;
