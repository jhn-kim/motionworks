const hero = document.querySelector('.hero');
const schema = { radius: { type: 'spatial-radius', unit: 'px' } };

function render() {
  const { radius } = window.MotionWorks.readParams(hero, schema);
  hero.textContent = `${Math.round(radius)}px`;
}

window.addEventListener('load', render);
hero.addEventListener('motionworks:change', render);
