/**
 * A short, human reading of a User-Agent header: "Firefox 130 · Windows". Only the
 * handful of browsers and systems an admin is likely to see are recognised; anything
 * else comes back as null and the page shows the raw header instead. The order of
 * the checks matters, since most browsers also name the engines they are built on.
 */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;

  const browsers: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
    [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).*Safari\//, 'Safari'],
  ];
  let browser: string | null = null;
  for (const [pattern, name] of browsers) {
    const match = pattern.exec(userAgent);
    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }

  const systems: Array<[RegExp, string]> = [
    [/Windows/, 'Windows'],
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux|X11/, 'Linux'],
  ];
  const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system;
}

/**
 * The name of a country in the interface language ("DE" -> "Germany" / "Deutschland"), from the browser's
 * own tables - no list is shipped with the app. A code the browser does not know comes back as it is.
 */
export function countryName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const RANGE_OPTIONS = ['24h', '7d', '30d', 'all'] as const;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
