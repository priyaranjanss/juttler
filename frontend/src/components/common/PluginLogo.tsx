import React from 'react';

interface PluginLogoProps {
  /** Plugin slug — decides which mark is drawn. */
  slug: string;
  /** Rendered pixel size (square). */
  size?: number;
  className?: string;
}

/**
 * SVG marks for each marketplace plugin.
 *
 * Drawn as inline SVG rather than images so they inherit size, stay crisp, and
 * need no network request or asset pipeline. Colours are the vendors' own.
 */
export const PluginLogo: React.FC<PluginLogoProps> = ({ slug, size = 24, className }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true as const,
    focusable: 'false' as const,
  };

  switch (slug) {
    case 'github':
      return (
        <svg {...common} fill="#181717">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      );

    case 'slack':
      // Four-armed pinwheel in Slack's brand palette
      return (
        <svg {...common}>
          <rect x="2" y="9" width="9" height="6" rx="3" fill="#36C5F0" />
          <rect x="13" y="2" width="9" height="6" rx="3" fill="#2EB67D" />
          <rect x="13" y="16" width="9" height="6" rx="3" fill="#ECB22E" />
          <rect x="2" y="16" width="9" height="6" rx="3" fill="#E01E5A" />
        </svg>
      );

    case 'jira':
      // Stacked chevrons in Atlassian blue
      return (
        <svg {...common}>
          <path d="M12 1.6 22.4 12 12 22.4 1.6 12z" fill="#2684FF" />
          <path d="M12 6.4 17.6 12 12 17.6 6.4 12z" fill="#0052CC" />
          <path d="M12 10.4 13.6 12 12 13.6 10.4 12z" fill="#fff" />
        </svg>
      );

    case 'gmail':
      // Google's four brand colours forming the envelope M
      return (
        <svg {...common}>
          <path d="M2.5 5.6 12 12l9.5-6.4" fill="none" stroke="#4285F4" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M2.5 5.6v12.8l6.2-4.7" fill="none" stroke="#EA4335" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M21.5 5.6v12.8l-6.2-4.7" fill="none" stroke="#34A853" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M2.5 18.4 12 21l9.5-2.6" fill="none" stroke="#FBBC05" strokeWidth="2.2" strokeLinejoin="round" />
        </svg>
      );

    default:
      // Neutral puzzle mark for anything without a dedicated logo
      return (
        <svg {...common}>
          <path
            d="M9 3h6v2.2a2.4 2.4 0 1 0 3.4 3.4H21v6h-2.2a2.4 2.4 0 1 0-3.4 3.4V21H9v-2.2a2.4 2.4 0 1 0-3.4-3.4H3V9h2.2A2.4 2.4 0 1 0 9 5.2z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>
      );
  }
};

export default PluginLogo;
