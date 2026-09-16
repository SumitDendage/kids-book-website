import { notFound } from 'next/navigation';
import { BRAND, SHEETS, classById, sheetById } from '@/lib/content';
import SheetDetail from '@/components/site/SheetDetail';
import { Footer } from '@/components/site/Sections';

export function generateStaticParams() {
  return SHEETS.map(s => ({ id: s.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const sheet = sheetById(id);
  if (!sheet) return {};
  return { title: sheet.title + ' · ' + classById(sheet.cls).label + ' — ' + BRAND.name, description: sheet.blurb };
}

export default async function SheetPage({ params }) {
  const { id } = await params;
  const sheet = sheetById(id);
  if (!sheet) notFound();
  return (
    <>
      <SheetDetail sheet={sheet} />
      <Footer />
    </>
  );
}
