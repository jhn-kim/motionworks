import { m, motion } from "framer-motion";

import BaseCard from "./BaseCard";

// Factory component: no `motion.` at the JSX site, used as <Card>.
const Card = motion(BaseCard);

export function AliasCard() {
  return (
    <>
      {/* Aliased binding `m` (LazyMotion idiom) + scroll reveal. */}
      <m.div whileInView={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        reveal
      </m.div>
      <Card animate={{ scale: 1 }} transition={{ duration: 0.5 }} />
    </>
  );
}
