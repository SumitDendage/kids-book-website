import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import LogoTile from '../common/LogoTile.jsx';

/* 02 · About us */
export default function AboutChapter() {
  return (
    <Chapter index={1}>
      <Rise as="p" i={0} className="eyebrow">02 / A little about us</Rise>
      <Rise i={1} className="about-head"><LogoTile className="logo-round" aria-hidden="true" /><h2 className="h2" style={{ margin: 0 }}>About Us</h2></Rise>
      <Rise i={2} className="about-copy">
        <p className="lede">At Learn with Why, we believe every child’s curiosity is the beginning of learning. We create phonics books, worksheets and educational resources that make learning clear, enjoyable and meaningful.</p>
        <p className="lede">Our materials help children build strong foundations in reading, writing and everyday learning, while supporting parents and teachers with easy-to-use activities.</p>
        <p className="lede">Our goal is simple: to help children understand, ask “why” and grow into confident learners.</p>
        <p className="lede">At Learn with Why, our worksheets are designed by a team of experienced teachers with backgrounds in the American and British curriculum. Drawing on their classroom experience, they create clear, engaging activities that help children build essential skills, grow in confidence, and enjoy learning.</p>
      </Rise>
      <Rise i={3} className="about-grid">
        <div className="panel"><h3>Why we started</h3><p>We kept printing worksheets that were loud, cluttered and full of clip art. So we drew our own: one idea per page, generous white space, and a question at the bottom that starts with why.</p>
          <ul className="ticks"><li>Designed with teachers, not stock templates</li><li>Ink-friendly — a full pack costs pennies to print</li><li>One purchase, unlimited home printing within your licence</li></ul></div>
        <div className="panel"><h3>How it works</h3><p>Pick a sheet or a worksheet, unlock it, and print it at home as many times as your licence allows. Free access sheets need nothing but a printer.</p>
          <div className="stats"><div className="stat"><b>120+</b><span>Sheets</span></div><div className="stat"><b>310</b><span>Classrooms</span></div><div className="stat"><b>4.9</b><span>Parent rating</span></div></div></div>
      </Rise>
    </Chapter>
  );
}
