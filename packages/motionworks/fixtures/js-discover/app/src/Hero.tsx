import { motion } from "framer-motion";

// HIGH significance (entrance: initial/animate), HIGH confidence (inline transition literal).
export function Hero() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      Hero
    </motion.section>
  );
}
