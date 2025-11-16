// System message custom element
class SystemMessage extends HTMLElement {
  connectedCallback() {
    this.render();
  }
  render() {
    const message = this.getAttribute('message');
    this.innerHTML = '';
    const sysSpan = document.createElement('span');
    sysSpan.className = 'system-message';
    sysSpan.textContent = message;
    sysSpan.style.color = '#888';
    sysSpan.style.fontStyle = 'italic';
    this.appendChild(sysSpan);
  }
}

if (!customElements.get('system-message')) {
  customElements.define('system-message', SystemMessage);
}
