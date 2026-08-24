import { motion } from "framer-motion";

// Commented-out motion must not be reported (AST ignores comments):
// <motion.div animate={{ opacity: 1 }} transition={{ duration: 7 }} />
export function Placeholder() {
  return <div>nothing animated here</div>;
}

// Keep the import "used" so this stays valid TSX without emitting a finding.
export const _unused = motion;
