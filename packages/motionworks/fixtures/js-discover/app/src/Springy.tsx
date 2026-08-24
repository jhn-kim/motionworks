import { animated, useSpring, useTransition } from "@react-spring/web";

const items = [1, 2, 3];

export function Springy() {
  // react-spring useSpring — distinct from Framer's useSpring in Hooks.tsx.
  const styles = useSpring({
    from: { opacity: 0 },
    to: { opacity: 1 },
    config: { tension: 200 },
  });
  const transitions = useTransition(items, {
    from: { opacity: 0 },
    enter: { opacity: 1 },
  });
  void transitions;
  return <animated.div style={styles} />;
}
