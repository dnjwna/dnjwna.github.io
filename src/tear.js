import { sound } from './sound.js';

/* "Print this receipt": the on-page receipt is tugged, torn off the roll and
   falls away; the print dialog opens; afterwards a fresh copy feeds back in. */

const tape = (text) => window.dispatchEvent(new CustomEvent('receipt:tape', { detail: text }));

function waitForAnimation(el, name, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('animationend', onEnd);
      resolve();
    };
    const onEnd = (e) => e.target === el && e.animationName === name && finish();
    el.addEventListener('animationend', onEnd);
    setTimeout(finish, fallbackMs); // never hang if the event is missed
  });
}

export function initTear({ reduced = false } = {}) {
  const btn = document.getElementById('printReceipt');
  const wrap = document.querySelector('.receipt-wrap');
  if (!btn || !wrap) return;
  let busy = false;

  btn.addEventListener('click', async () => {
    if (busy) return;
    if (reduced) {
      window.print();
      return;
    }
    busy = true;
    btn.disabled = true;

    tape('> tearing off receipt');
    sound.tear();
    wrap.classList.add('is-tearing');
    await waitForAnimation(wrap, 'receiptTear', 1400);

    // Chrome blocks inside print() until the dialog closes; Safari returns early
    // and fires afterprint later. Either way, refeed exactly once.
    let refed = false;
    const refeed = async () => {
      if (refed) return;
      refed = true;
      window.removeEventListener('afterprint', refeed);
      tape('> printing a fresh copy');
      wrap.classList.remove('is-tearing');
      wrap.classList.add('is-refeeding');
      for (let i = 0; i < 14; i++) setTimeout(() => sound.buzz(), i * 70);
      await waitForAnimation(wrap, 'receiptRefeed', 1600);
      wrap.classList.remove('is-refeeding');
      tape('> receipt reprinted');
      btn.disabled = false;
      busy = false;
    };
    window.addEventListener('afterprint', refeed);
    window.print();
    setTimeout(refeed, 600);
  });
}
