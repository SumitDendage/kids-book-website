/* A slim candy bar along the very top that fills as you move through the six chapters, so
   visitors can see how much of the story is left. The chapter stage already writes how far along
   we are into --scroll on every frame, so the bar needs no JavaScript of its own: the browser
   scales it on the compositor (styles/40-motion.css). */
export default function ScrollProgress() {
  return <div className="mo-progress" aria-hidden="true"><span /></div>;
}
