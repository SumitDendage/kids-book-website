import Stage from '@/components/site/Stage';
import { About, Contact, Footer, Testimonials } from '@/components/site/Sections';

export default function Home() {
  return (
    <>
      <Stage />
      <About />
      <Contact />
      <Testimonials />
      <Footer />
    </>
  );
}
