import { useTranslation } from 'react-i18next';
import type { JournalAddressScope } from '@ts6/common';
import { countryName } from './format';

/**
 * Where an address is: the country (code and name in the interface language) with the place under it when
 * the database has one; for an address that cannot be placed, why - a private network, this machine, or
 * simply no entry (which is also what an address looks like before a database is installed).
 */
export function CountryCell({
  country, region, city, scope,
}: {
  country: string | null;
  region?: string | null;
  city: string | null;
  scope: JournalAddressScope;
}) {
  const { t, i18n } = useTranslation();

  if (country) {
    // "Berlin, Berlin" says nothing twice: the city and its region often have the same name.
    const place = Array.from(new Set([city, region].filter((p): p is string => !!p))).join(', ');
    return (
      <div data-testid="journal-country">
        <span className="font-mono-data text-[11px] rounded border border-border px-1 mr-1.5">{country}</span>
        <span>{countryName(country, i18n.language)}</span>
        {place && <div className="text-[11px] text-muted-foreground">{place}</div>}
      </div>
    );
  }
  if (scope === 'private') return <span className="text-xs text-muted-foreground">{t('pages.connectionJournal.scope.private')}</span>;
  if (scope === 'loopback') return <span className="text-xs text-muted-foreground">{t('pages.connectionJournal.scope.loopback')}</span>;
  return <span className="text-muted-foreground" title={t('pages.connectionJournal.noCountryHint')}>–</span>;
}
