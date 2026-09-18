import { Cormorant_Garamond, Nunito } from 'next/font/google';
import { BRAND } from '@/lib/content';
import Providers from '@/components/chrome/Providers';
import Loader from '@/components/chrome/Loader';
import Nav from '@/components/chrome/Nav';
import Overlays from '@/components/chrome/Overlays';
import './globals.css';

const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['500', '600', '700'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap' });

export const metadata = {
  title: BRAND.name + ' — ' + BRAND.tagline,
  description: 'Printable sheets for Nursery to Class 3 — alphabet, numbers, science and stories. One free sheet in every class; the rest unlock and open in your Library.',
};
export const viewport = { themeColor: '#0a1310', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={cormorant.variable + ' ' + nunito.variable}>
      <body>
        <Providers>
          <Loader />
          <Nav />
          {children}
          <Overlays />
        </Providers>
      </body>
    </html>
  );
}
