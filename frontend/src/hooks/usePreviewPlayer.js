import { useEffect, useRef } from 'react';
import { makePlayer } from '../services/foxFrames.js';

/* Runs the fox & rabbit animation on a canvas while `playing` is true. */
export default function usePreviewPlayer(canvasRef, fps, playing) {
  const playerRef = useRef(null);
  useEffect(() => {
    const p = makePlayer(canvasRef.current, fps);
    playerRef.current = p;
    return () => { p.destroy(); playerRef.current = null; };
  }, [canvasRef, fps]);
  useEffect(() => {
    const p = playerRef.current; if (!p) return;
    if (playing) p.play(); else p.pause();
  }, [playing]);
  return playerRef;
}
