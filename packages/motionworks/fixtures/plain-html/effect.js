const hero = document.querySelector(".hero");
const heroValue = document.querySelector(".hero-value");
const heroSchema = {
  radius: {
    type: "spatial-radius",
    unit: "px",
    min: 64,
    max: 220,
  },
};

function renderHeroValue() {
  const { radius } = window.MotionWorks.readParams(hero, heroSchema);
  heroValue.textContent = `${Math.round(radius)}px`;
}

window.addEventListener("load", renderHeroValue);
hero.addEventListener("motionworks:change", renderHeroValue);

for (const effect of document.querySelectorAll("[data-motionworks]")) {
  effect.addEventListener("motionworks:replay", () => {
    const animatedNodes = [effect, ...effect.querySelectorAll("*")];
    const animations = animatedNodes.flatMap((node) =>
      typeof node.getAnimations === "function" ? node.getAnimations() : [],
    );
    for (const animation of animations) {
      animation.cancel();
      animation.play();
    }
  });
}
