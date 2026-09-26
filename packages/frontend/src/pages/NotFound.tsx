import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center">
        <FileQuestion className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold">{t('pages.notFound.title')}</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        {t('pages.notFound.description')}
      </p>
      <Button variant="outline" onClick={() => navigate('/dashboard')}>
        {t('pages.notFound.backToDashboard')}
      </Button>
    </div>
  );
}
