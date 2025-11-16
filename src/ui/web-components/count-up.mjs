import { signal, component } from 'reefjs';

if (!customElements.get('count-up')) {
  customElements.define(
    'count-up',
    class extends HTMLElement {
      // Instantiate the component
      constructor() {
        super();
        this.uuid = crypto.randomUUID();
        this.count = signal(0, this.uuid);
        this.events = { countUp: () => this.count.value++ };
        component(this, this.template, {
          events: this.events,
          signals: [this.uuid],
        });
      }

      // The UI template
      template = () => {
        return `<button onclick="countUp()">Clicked ${this.count.value} times</button>`;
      };
    },
  );
}
