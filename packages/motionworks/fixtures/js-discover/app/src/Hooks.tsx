import { useAnimate, useScroll, useSpring, useTransform } from "framer-motion";

// Imperative + value hooks with NO motion element on screen — the case a
// grep for `<motion.` misses entirely. All resolve to framer-motion via the
// import binding (note: useSpring here is Framer's, not react-spring's).
export function Hooks() {
  const [scope, animate] = useAnimate();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, 100]);
  const spring = useSpring(0);
  void animate;
  void y;
  void spring;
  return <div ref={scope} />;
}
