import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function GsapScroll() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    // HIGH significance (scrollTrigger/scrub), HIGH confidence (vars literal).
    gsap.to(ref.current, {
      x: 100,
      duration: 1.2,
      scrollTrigger: { trigger: ref.current, scrub: true },
    });
    // MEDIUM significance entrance tween.
    gsap.from(".box", { opacity: 0, duration: 0.4 });
  });
  return <div ref={ref} className="box" />;
}
