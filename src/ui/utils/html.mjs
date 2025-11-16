const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * HTML template tag - auto-escapes interpolated values
 * @param {TemplateStringsArray} strings - Template string parts
 * @param {...any} values - Values to interpolate
 * @returns {string} - Escaped HTML string
 */
export function html(strings, ...values) {
  return strings.reduce((result, str, i) => {
    const value = values[i];
    if (value === undefined) return result + str;

    // Check if value is a raw HTML object
    if (value && typeof value === 'object' && '__html' in value) {
      return result + str + value.__html;
    }

    // Auto-escape unless it's a number or boolean
    const escaped =
      typeof value === 'number' || typeof value === 'boolean'
        ? value
        : escapeHtml(value);

    return result + str + escaped;
  }, '');
}

/**
 * Raw HTML marker - prevents escaping
 * Use with caution, only for trusted content!
 */
export function raw(str) {
  return { __html: str };
}

export function attr(name, value) {
  if (value == null || value === false) {
    return '';
  }
  if (value === true) {
    return raw(` ${name}="true"`);
  }
  return raw(` ${name}="${escapeHtml(String(value))}"`);
}

export function attrs(attributes) {
  return Object.entries(attributes)
    .map(([key, value]) => attr(key, value))
    .join('');
}
