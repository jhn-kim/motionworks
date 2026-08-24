import { motion } from "framer-motion";

// Test file — excluded from discovery even though it uses motion.
export function harness() {
  return <motion.div animate={{ opacity: 1 }} transition={{ duration: 9 }} />;
}
