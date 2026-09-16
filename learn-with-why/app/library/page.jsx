import { BRAND, LIBRARY } from '@/lib/content';
import LibraryView from '@/components/library/Library';
import { Footer } from '@/components/site/Sections';

export const metadata = { title: LIBRARY.nav + ' — ' + BRAND.name };

export default function LibraryPage() {
  return (
    <>
      <LibraryView />
      <Footer />
    </>
  );
}
