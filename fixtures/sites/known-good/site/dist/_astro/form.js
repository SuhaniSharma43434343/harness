for (const form of document.querySelectorAll('form[data-forge-form]')) {
  const status = form.querySelector('.form-status');
  const show = (state, text) => { status.dataset.state = state; status.textContent = text; };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.getAttribute('action')) { show('error', 'This form is not connected yet, so nothing was sent.'); return; }
    show('sending', 'Sending…');
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      show('success', 'Thank you. Your message was sent.');
    } catch {
      show('error', 'Sorry, your message could not be sent. Please try again.');
    }
  });
}
