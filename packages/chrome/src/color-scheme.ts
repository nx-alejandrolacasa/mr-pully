export const COLOR_SCHEME_MESSAGE = "color-scheme";

export interface ColorSchemeMessage {
  type: typeof COLOR_SCHEME_MESSAGE;
  dark: boolean;
}

export function isColorSchemeMessage(message: unknown): message is ColorSchemeMessage {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === COLOR_SCHEME_MESSAGE;
}
