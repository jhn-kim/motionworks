import { motion } from "framer-motion";

const rows = ["a", "b", "c"];

// Mapped instances collapse to a single grouped entry (count = 3). whileHover
// only => LOW significance micro-interaction.
export function List() {
  return (
    <ul>
      {rows.map((r) => (
        <motion.li key={r} whileHover={{ scale: 1.05 }}>
          {r}
        </motion.li>
      ))}
    </ul>
  );
}
