// Wires a Spline scene to the page, both ways. Pure apart from the objects it is given, so it
// can be tested without a browser or a real scene.
//   events:   [{ on: 'mouseDown', object: 'Button', dispatch: 'lumen:open' }]
//             a Spline event on an object dispatches a DOM CustomEvent on the section.
//   triggers: [{ selector: '#play', event: 'click', emit: 'mouseDown', object: 'Cube' }]
//             a DOM event on an element emits a Spline event on an object.
// Returns a function that removes every listener it added.
export function wireEvents(app, root, { events = [], triggers = [] } = {}) {
  const off = [];
  for (const e of events) {
    const handler = (ev) => {
      const name = ev?.target?.name;
      if (e.object && name !== e.object) return;
      root.dispatchEvent(new CustomEvent(e.dispatch, { bubbles: true, detail: { object: name, event: e.on } }));
    };
    app.addEventListener(e.on, handler);
    off.push(() => app.removeEventListener?.(e.on, handler));
  }
  for (const t of triggers) {
    for (const el of root.ownerDocument.querySelectorAll(t.selector)) {
      const handler = () => app.emitEvent(t.emit, t.object);
      el.addEventListener(t.event ?? 'click', handler);
      off.push(() => el.removeEventListener(t.event ?? 'click', handler));
    }
  }
  return () => off.forEach((f) => f());
}
