import { motion } from "framer-motion";

// LOW confidence: transition arrives via a spread, not an inline literal, so
// the value isn't statically decidable. Still a real animation — must be
// reported, but never auto-lifted.
const animProps = { transition: { duration: 0.2 } };

export const Spread = () => <motion.div {...animProps} />;
