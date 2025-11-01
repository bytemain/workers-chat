/**
 * Simple tooltip utility
 * Creates a floating tooltip that doesn't affect layout
 */

class Tooltip {
  constructor() {
    this.tooltipElement = null;
    this.currentTarget = null;
    this.hideTimeout = null;
    this.init();
  }

  init() {
    // Create tooltip element
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'custom-tooltip';
    this.tooltipElement.style.cssText = `
      position: fixed;
      background: #2f3136;
      color: #dcddde;
      padding: 8px 12px;
      border-radius: 5px;
      font-size: 14px;
      font-weight: 500;
      pointer-events: none;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(this.tooltipElement);

    // Create arrow element
    this.arrowElement = document.createElement('div');
    this.arrowElement.className = 'custom-tooltip-arrow';
    this.arrowElement.style.cssText = `
      position: absolute;
      width: 0;
      height: 0;
      border-style: solid;
    `;
    this.tooltipElement.appendChild(this.arrowElement);
  }

  /**
   * Attach tooltip to an element
   * @param {HTMLElement} element - Element to attach tooltip to
   * @param {string} text - Tooltip text
   * @param {string} position - Position: 'top', 'bottom', 'left', 'right' (default: 'right')
   */
  attach(element, text, position = 'right') {
    element.addEventListener('mouseenter', (e) => {
      this.show(e.currentTarget, text, position);
    });

    element.addEventListener('mouseleave', () => {
      this.hide();
    });
  }

  /**
   * Show tooltip
   * @param {HTMLElement} target - Target element
   * @param {string} text - Tooltip text
   * @param {string} position - Position
   */
  show(target, text, position = 'right') {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.currentTarget = target;

    // Set text content without removing arrow
    const textNodes = Array.from(this.tooltipElement.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    textNodes.forEach((node) => node.remove());
    this.tooltipElement.insertBefore(
      document.createTextNode(text),
      this.arrowElement,
    );

    this.tooltipElement.style.opacity = '0';
    this.tooltipElement.style.display = 'block';

    // Calculate position
    requestAnimationFrame(() => {
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = this.tooltipElement.getBoundingClientRect();
      let left, top;

      const gap = 8; // Gap between target and tooltip
      const arrowSize = 6;

      // Reset arrow styles
      this.arrowElement.style.borderWidth = '0';
      this.arrowElement.style.top = 'auto';
      this.arrowElement.style.bottom = 'auto';
      this.arrowElement.style.left = 'auto';
      this.arrowElement.style.right = 'auto';

      switch (position) {
        case 'top':
          left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
          top = targetRect.top - tooltipRect.height - gap;
          // Arrow pointing down
          this.arrowElement.style.borderWidth = `${arrowSize}px ${arrowSize}px 0 ${arrowSize}px`;
          this.arrowElement.style.borderColor =
            '#2f3136 transparent transparent transparent';
          this.arrowElement.style.bottom = `-${arrowSize}px`;
          this.arrowElement.style.left = '50%';
          this.arrowElement.style.transform = 'translateX(-50%)';
          break;
        case 'bottom':
          left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
          top = targetRect.bottom + gap;
          // Arrow pointing up
          this.arrowElement.style.borderWidth = `0 ${arrowSize}px ${arrowSize}px ${arrowSize}px`;
          this.arrowElement.style.borderColor =
            'transparent transparent #2f3136 transparent';
          this.arrowElement.style.top = `-${arrowSize}px`;
          this.arrowElement.style.left = '50%';
          this.arrowElement.style.transform = 'translateX(-50%)';
          break;
        case 'left':
          left = targetRect.left - tooltipRect.width - gap;
          top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
          // Arrow pointing right
          this.arrowElement.style.borderWidth = `${arrowSize}px 0 ${arrowSize}px ${arrowSize}px`;
          this.arrowElement.style.borderColor =
            'transparent transparent transparent #2f3136';
          this.arrowElement.style.right = `-${arrowSize}px`;
          this.arrowElement.style.top = '50%';
          this.arrowElement.style.transform = 'translateY(-50%)';
          break;
        case 'right':
        default:
          left = targetRect.right + gap;
          top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
          // Arrow pointing left
          this.arrowElement.style.borderWidth = `${arrowSize}px ${arrowSize}px ${arrowSize}px 0`;
          this.arrowElement.style.borderColor =
            'transparent #2f3136 transparent transparent';
          this.arrowElement.style.left = `-${arrowSize}px`;
          this.arrowElement.style.top = '50%';
          this.arrowElement.style.transform = 'translateY(-50%)';
          break;
      }

      // Keep tooltip within viewport
      const padding = 8;
      if (left < padding) left = padding;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }
      if (top < padding) top = padding;
      if (top + tooltipRect.height > window.innerHeight - padding) {
        top = window.innerHeight - tooltipRect.height - padding;
      }

      this.tooltipElement.style.left = left + 'px';
      this.tooltipElement.style.top = top + 'px';

      // Fade in
      requestAnimationFrame(() => {
        this.tooltipElement.style.opacity = '1';
      });
    });
  } /**
   * Hide tooltip
   */
  hide() {
    this.hideTimeout = setTimeout(() => {
      this.tooltipElement.style.opacity = '0';
      this.currentTarget = null;

      setTimeout(() => {
        this.tooltipElement.style.display = 'none';
      }, 150);
    }, 50);
  }

  /**
   * Destroy tooltip
   */
  destroy() {
    if (this.tooltipElement && this.tooltipElement.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
  }
}

// Create singleton instance
const tooltip = new Tooltip();

export default tooltip;
