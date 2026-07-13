import type { AgentView } from "@shared/agent-types";

export interface BrandIconProps {
  size?: number;
  className?: string;
}

export function PowerShellIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M124.912 19.358c-.962-1.199-2.422-1.858-4.111-1.858h-92.61c-3.397 0-6.665 2.642-7.444 6.015L2.162 104.022c-.396 1.711-.058 3.394.926 4.619.963 1.199 2.423 1.858 4.111 1.858v.001H99.81c3.396 0 6.665-2.643 7.443-6.016l18.586-80.508c.395-1.711.057-3.395-.927-4.618zm-98.589 77.17c-1.743-2.397-1.323-5.673.94-7.318l37.379-27.067v-.556L41.157 36.603c-1.916-2.038-1.716-5.333.445-7.361 2.162-2.027 5.466-2.019 7.382.019l28.18 29.979c1.6 1.702 1.718 4.279.457 6.264-.384.774-1.182 1.628-2.593 2.618l-41.45 29.769c-2.263 1.644-5.512 1.034-7.255-1.363zm59.543.538H63.532c-2.597 0-4.702-2.082-4.702-4.65s2.105-4.65 4.702-4.65h22.333c2.597 0 4.702 2.082 4.702 4.65s-2.104 4.65-4.701 4.65z"
      />
    </svg>
  );
}

export function VSCodeIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z"
      />
    </svg>
  );
}

export function GitHubIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M64 5.103c-33.347 0-60.388 27.035-60.388 60.388 0 26.682 17.303 49.317 41.297 57.303 3.017.56 4.125-1.31 4.125-2.905 0-1.44-.056-6.197-.082-11.243-16.8 3.653-20.345-7.125-20.345-7.125-2.747-6.98-6.705-8.836-6.705-8.836-5.48-3.748.413-3.67.413-3.67 6.063.425 9.257 6.223 9.257 6.223 5.386 9.23 14.127 6.562 17.573 5.02.542-3.903 2.107-6.568 3.834-8.076-13.413-1.525-27.514-6.704-27.514-29.843 0-6.593 2.36-11.98 6.223-16.21-.628-1.52-2.695-7.662.584-15.98 0 0 5.07-1.623 16.61 6.19C53.7 35 58.867 34.327 64 34.304c5.13.023 10.3.694 15.127 2.033 11.526-7.813 16.59-6.19 16.59-6.19 3.287 8.317 1.22 14.46.593 15.98 3.872 4.23 6.215 9.617 6.215 16.21 0 23.194-14.127 28.3-27.574 29.796 2.167 1.874 4.097 5.55 4.097 11.183 0 8.08-.07 14.583-.07 16.572 0 1.607 1.088 3.49 4.148 2.897 23.98-7.994 41.263-30.622 41.263-57.294C124.388 32.14 97.35 5.104 64 5.104z"
      />
      <path d="M26.484 91.806c-.133.3-.605.39-1.035.185-.44-.196-.685-.605-.543-.906.13-.31.603-.395 1.04-.188.44.197.69.61.537.91zm2.446 2.729c-.287.267-.85.143-1.232-.28-.396-.42-.47-.983-.177-1.254.298-.266.844-.14 1.24.28.394.426.472.984.17 1.255zM31.312 98.012c-.37.258-.976.017-1.35-.52-.37-.538-.37-1.183.01-1.44.373-.258.97-.025 1.35.507.368.545.368 1.19-.01 1.452zm3.261 3.361c-.33.365-1.036.267-1.552-.23-.527-.487-.674-1.18-.343-1.544.336-.366 1.045-.264 1.564.23.527.486.686 1.18.333 1.543zm4.5 1.951c-.147.473-.825.688-1.51.486-.683-.207-1.13-.76-.99-1.238.14-.477.823-.7 1.512-.485.683.206 1.13.756.988 1.237zm4.943.361c.017.498-.563.91-1.28.92-.723.017-1.308-.387-1.315-.877 0-.503.568-.91 1.29-.924.717-.013 1.306.387 1.306.88zm4.598-.782c.086.485-.413.984-1.126 1.117-.7.13-1.35-.172-1.44-.653-.086-.498.422-.997 1.122-1.126.714-.123 1.354.17 1.444.663z"
      />
    </svg>
  );
}

export function ClaudeCodeIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  );
}

export function CodexIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
      />
    </svg>
  );
}

/** Brand marks the app ships. An agent the user added has none, and falls back to a monogram. */
const BRAND_ICONS: Record<string, (props: BrandIconProps) => JSX.Element> = {
  powershell: PowerShellIcon,
  claude: ClaudeCodeIcon,
  codex: CodexIcon,
};

/**
 * Only some marks are legible in their brand colour against both themes, so the rest stay in the
 * text colour. Session rows tint their icon by status instead, and never ask for this.
 */
const BRAND_ACCENT_CLASS: Record<string, string> = {
  powershell: "brand-icon-powershell",
  claude: "brand-icon-claude",
};

export function agentAccentClass(agent: AgentView | undefined): string | undefined {
  return agent?.icon ? BRAND_ACCENT_CLASS[agent.icon] : undefined;
}

export interface AgentIconProps extends BrandIconProps {
  /** Undefined when the session names an agent that is no longer in `agents.json`. */
  agent: AgentView | undefined;
}

export function AgentIcon({ agent, size = 24, className }: AgentIconProps) {
  const Brand = agent?.icon ? BRAND_ICONS[agent.icon] : undefined;
  if (Brand) return <Brand size={size} className={className} />;
  const initial = (agent?.label.trim() || agent?.id || "?").charAt(0).toLocaleUpperCase("en-US");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      // An agent may name its own colour; without one it takes the colour of the text around it.
      style={agent?.accentColor ? { color: agent.accentColor } : undefined}
      role="img"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" opacity="0.18" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="600"
        fill="currentColor"
      >
        {initial}
      </text>
    </svg>
  );
}
