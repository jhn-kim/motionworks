// The renamed package: `motion` / `motion/react`, not `framer-motion`.
import { motion } from "motion/react";

export function NewPkg() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      renamed package
    </motion.div>
  );
}
