import { hashCode } from './utils.mjs';
/*
 *********** UTILS ***********
 */

const getDigit = (number, index) => {
  const d = Math.floor((number / Math.pow(10, index)) % 10);
  return d;
};

const getBoolean = (number, index) => {
  return !(getDigit(number, index) % 2);
};

const getUnit = (number, range, index) => {
  const value = number % range;

  if (index && getDigit(number, index) % 2 === 0) {
    return -value;
  }
  return value;
};

const getRandomColor = (number, colors, range) => {
  return colors[number % range];
};

const getContrastColor = (hexcolor) => {
  hexcolor = hexcolor.replace('#', '');

  // Convert to RGB value
  const r = parseInt(hexcolor.substr(0, 2), 16);
  const g = parseInt(hexcolor.substr(2, 2), 16);
  const b = parseInt(hexcolor.substr(4, 2), 16);

  // Get YIQ ratio
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  // Check contrast
  return yiq >= 128 ? '#000000' : '#FFFFFF';
};

const sanitizeColors = (colors) => {
  if (Array.isArray(colors)) {
    return colors.map((color) => '#' + color.replace(/[^0-9A-Fa-f]/g, ''));
  } else if (typeof colors === 'string') {
    return sanitizeColors(colors.split(','));
  }
  return [];
};

/*
 *********** BEAM ***********
 */

// Color palettes - each palette has 5 harmonious colors with good contrast
const COLOR_PALETTES = [
  ['#0a0310', '#49007e', '#ff005b', '#ff7d10', '#ffb238'], // purple-pink-orange (original)
  ['#69d2e7', '#a7dbd8', '#e0e4cc', '#f38630', '#fa6900'],
  ['#fe4365', '#fc9d9a', '#f9cdad', '#c8c8a9', '#83af9b'],
  ['#ecd078', '#d95b43', '#c02942', '#542437', '#53777a'],
  ['#556270', '#4ecdc4', '#c7f464', '#ff6b6b', '#c44d58'],
  ['#774f38', '#e08e79', '#f1d4af', '#ece5ce', '#c5e0dc'],
  ['#e8ddcb', '#cdb380', '#036564', '#033649', '#031634'],
  ['#490a3d', '#bd1550', '#e97f02', '#f8ca00', '#8a9b0f'],
  ['#594f4f', '#547980', '#45ada8', '#9de0ad', '#e5fcc2'],
  ['#00a0b0', '#6a4a3c', '#cc333f', '#eb6841', '#edc951'],
  ['#e94e77', '#d68189', '#c6a49a', '#c6e5d9', '#f4ead5'],
  ['#3fb8af', '#7fc7af', '#dad8a7', '#ff9e9d', '#ff3d7f'],
  ['#d9ceb2', '#948c75', '#d5ded9', '#7a6a53', '#99b2b7'],
  ['#ffffff', '#cbe86b', '#f2e9e1', '#1c140d', '#cbe86b'],
  ['#efffcd', '#dce9be', '#555152', '#2e2633', '#99173c'],
  ['#343838', '#005f6b', '#008c9e', '#00b4cc', '#00dffc'],
  ['#413e4a', '#73626e', '#b38184', '#f0b49e', '#f7e4be'],
  ['#ff4e50', '#fc913a', '#f9d423', '#ede574', '#e1f5c4'],
  ['#99b898', '#fecea8', '#ff847c', '#e84a5f', '#2a363b'],
  ['#655643', '#80bca3', '#f6f7bd', '#e6ac27', '#bf4d28'],
  ['#00a8c6', '#40c0cb', '#f9f2e7', '#aee239', '#8fbe00'],
  ['#351330', '#424254', '#64908a', '#e8caa4', '#cc2a41'],
  ['#554236', '#f77825', '#d3ce3d', '#f1efa5', '#60b99a'],
  ['#5d4157', '#838689', '#a8caba', '#cad7b2', '#ebe3aa'],
  ['#8c2318', '#5e8c6a', '#88a65e', '#bfb35a', '#f2c45a'],
  ['#fad089', '#ff9c5b', '#f5634a', '#ed303c', '#3b8183'],
  ['#ff4242', '#f4fad2', '#d4ee5e', '#e1edb9', '#f0f2eb'],
  ['#f8b195', '#f67280', '#c06c84', '#6c5b7b', '#355c7d'],
  ['#d1e751', '#ffffff', '#000000', '#4dbce9', '#26ade4'],
  ['#1b676b', '#519548', '#88c425', '#bef202', '#eafde6'],
  ['#5e412f', '#fcebb6', '#78c0a8', '#f07818', '#f0a830'],
  ['#bcbdac', '#cfbe27', '#f27435', '#f02475', '#3b2d38'],
  ['#452632', '#91204d', '#e4844a', '#e8bf56', '#e2f7ce'],
  ['#eee6ab', '#c5bc8e', '#696758', '#45484b', '#36393b'],
  ['#f0d8a8', '#3d1c00', '#86b8b1', '#f2d694', '#fa2a00'],
  ['#2a044a', '#0b2e59', '#0d6759', '#7ab317', '#a0c55f'],
  ['#f04155', '#ff823a', '#f2f26f', '#fff7bd', '#95cfb7'],
  ['#b9d7d9', '#668284', '#2a2829', '#493736', '#7b3b3b'],
  ['#bbbb88', '#ccc68d', '#eedd99', '#eec290', '#eeaa88'],
  ['#b3cc57', '#ecf081', '#ffbe40', '#ef746f', '#ab3e5b'],
  ['#a3a948', '#edb92e', '#f85931', '#ce1836', '#009989'],
  ['#300030', '#480048', '#601848', '#c04848', '#f07241'],
  ['#aab3ab', '#c4cbb7', '#ebefc9', '#eee0b7', '#e8caaf'],
  ['#e8d5b7', '#0e2430', '#fc3a51', '#f5b349', '#e8d5b9'],
  ['#ab526b', '#bca297', '#c5ceae', '#f0e2a4', '#f4ebc3'],
  ['#607848', '#789048', '#c0d860', '#f0f0d8', '#604848'],
  ['#b6d8c0', '#c8d9bf', '#dadabd', '#ecdbbc', '#fedcba'],
  ['#a8e6ce', '#dcedc2', '#ffd3b5', '#ffaaa6', '#ff8c94'],
  ['#3e4147', '#fffedf', '#dfba69', '#5a2e2e', '#2a2c31'],
  ['#fc354c', '#29221f', '#13747d', '#0abfbc', '#fcf7c5'],
  ['#cc0c39', '#e6781e', '#c8cf02', '#f8fcc1', '#1693a7'],
  ['#1c2130', '#028f76', '#b3e099', '#ffeaad', '#d14334'],
  ['#a7c5bd', '#e5ddcb', '#eb7b59', '#cf4647', '#524656'],
  ['#dad6ca', '#1bb0ce', '#4f8699', '#6a5e72', '#563444'],
  ['#5c323e', '#a82743', '#e15e32', '#c0d23e', '#e5f04c'],
  ['#edebe6', '#d6e1c7', '#94c7b6', '#403b33', '#d3643b'],
  ['#fdf1cc', '#c6d6b8', '#987f69', '#e3ad40', '#fcd036'],
  ['#230f2b', '#f21d41', '#ebebbc', '#bce3c5', '#82b3ae'],
  ['#b9d3b0', '#81bda4', '#b28774', '#f88f79', '#f6aa93'],
  ['#3a111c', '#574951', '#83988e', '#bcdea5', '#e6f9bc'],
  ['#5e3929', '#cd8c52', '#b7d1a3', '#dee8be', '#fcf7d3'],
  ['#1c0113', '#6b0103', '#a30006', '#c21a01', '#f03c02'],
  ['#000000', '#9f111b', '#b11623', '#292c37', '#cccccc'],
  ['#382f32', '#ffeaf2', '#fcd9e5', '#fbc5d8', '#f1396d'],
  ['#e3dfba', '#c8d6bf', '#93ccc6', '#6cbdb5', '#1a1f1e'],
  ['#f6f6f6', '#e8e8e8', '#333333', '#990100', '#b90504'],
  ['#1b325f', '#9cc4e4', '#e9f2f9', '#3a89c9', '#f26c4f'],
  ['#a1dbb2', '#fee5ad', '#faca66', '#f7a541', '#f45d4c'],
  ['#c1b398', '#605951', '#fbeec2', '#61a6ab', '#accec0'],
  ['#5e9fa3', '#dcd1b4', '#fab87f', '#f87e7b', '#b05574'],
  ['#951f2b', '#f5f4d7', '#e0dfb1', '#a5a36c', '#535233'],
  ['#8dccad', '#988864', '#fea6a2', '#f9d6ac', '#ffe9af'],
  ['#2d2d29', '#215a6d', '#3ca2a2', '#92c7a3', '#dfece6'],
  ['#413d3d', '#040004', '#c8ff00', '#fa023c', '#4b000f'],
  ['#eff3cd', '#b2d5ba', '#61ada0', '#248f8d', '#605063'],
  ['#ffefd3', '#fffee4', '#d0ecea', '#9fd6d2', '#8b7a5e'],
  ['#cfffdd', '#b4dec1', '#5c5863', '#a85163', '#ff1f4c'],
  ['#9dc9ac', '#fffec7', '#f56218', '#ff9d2e', '#919167'],
  ['#4e395d', '#827085', '#8ebe94', '#ccfc8e', '#dc5b3e'],
  ['#a8a7a7', '#cc527a', '#e8175d', '#474747', '#363636'],
  ['#f8edd1', '#d88a8a', '#474843', '#9d9d93', '#c5cfc6'],
  ['#046d8b', '#309292', '#2fb8ac', '#93a42a', '#ecbe13'],
  ['#f38a8a', '#55443d', '#a0cab5', '#cde9ca', '#f1edd0'],
  ['#a70267', '#f10c49', '#fb6b41', '#f6d86b', '#339194'],
  ['#ff003c', '#ff8a00', '#fabe28', '#88c100', '#00c176'],
  ['#ffedbf', '#f7803c', '#f54828', '#2e0d23', '#f8e4c1'],
  ['#4e4d4a', '#353432', '#94ba65', '#2790b0', '#2b4e72'],
  ['#0ca5b0', '#4e3f30', '#fefeeb', '#f8f4e4', '#a5b3aa'],
  ['#4d3b3b', '#de6262', '#ffb88c', '#ffd0b3', '#f5e0d3'],
  ['#fffbb7', '#a6f6af', '#66b6ab', '#5b7c8d', '#4f2958'],
  ['#edf6ee', '#d1c089', '#b3204d', '#412e28', '#151101'],
  ['#9d7e79', '#ccac95', '#9a947c', '#748b83', '#5b756c'],
  ['#fcfef5', '#e9ffe1', '#cdcfb7', '#d6e6c3', '#fafbe3'],
  ['#9cddc8', '#bfd8ad', '#ddd9ab', '#f7af63', '#633d2e'],
  ['#30261c', '#403831', '#36544f', '#1f5f61', '#0b8185'],
  ['#aaff00', '#ffaa00', '#ff00aa', '#aa00ff', '#00aaff'],
  ['#d1313d', '#e5625c', '#f9bf76', '#8eb2c5', '#615375'],
  ['#ffe181', '#eee9e5', '#fad3b2', '#ffba7f', '#ff9c97'],
  ['#73c8a9', '#dee1b6', '#e1b866', '#bd5532', '#373b44'],
  ['#805841', '#dcf7f3', '#fffcdd', '#ffd8d8', '#f5a2a2'],
];

function generateBeamData(name, colors, size) {
  const numFromName = hashCode(name);
  const range = colors && colors.length;
  const wrapperColor = getRandomColor(numFromName, colors, range);
  const preTranslateX = getUnit(numFromName, 10, 1);
  const wrapperTranslateX =
    preTranslateX < 5 ? preTranslateX + size / 9 : preTranslateX;
  const preTranslateY = getUnit(numFromName, 10, 2);
  const wrapperTranslateY =
    preTranslateY < 5 ? preTranslateY + size / 9 : preTranslateY;

  const isCircle = getBoolean(numFromName, 1);
  const wrapperRadius = isCircle
    ? size
    : Math.max(size / 6, size / 6 + getUnit(numFromName, size / 4, 9)); // varying corner radius, always >= size/6

  // Calculate safe face translation bounds based on wrapper radius
  // For larger radii (more circular), constrain face position more
  const radiusRatio = wrapperRadius / size; // 0.17 to 1.0
  const maxFaceTranslate = radiusRatio > 0.5 ? 4 : 8; // Constrain more for rounder shapes

  const baseFaceTranslateX =
    wrapperTranslateX > size / 6
      ? wrapperTranslateX / 2
      : getUnit(numFromName, maxFaceTranslate, 1);
  const baseFaceTranslateY =
    wrapperTranslateY > size / 6
      ? wrapperTranslateY / 2
      : getUnit(numFromName, maxFaceTranslate, 2);

  const data = {
    wrapperColor: wrapperColor,
    faceColor: getContrastColor(wrapperColor),
    backgroundColor: getRandomColor(numFromName + 13, colors, range),
    wrapperTranslateX: wrapperTranslateX,
    wrapperTranslateY: wrapperTranslateY,
    wrapperRotate: getUnit(numFromName, 360),
    wrapperScale: 1 + getUnit(numFromName, size / 12) / 10,
    isMouthOpen: getBoolean(numFromName, 2),
    isCircle: isCircle,
    eyeSpread: getUnit(numFromName, 5),
    mouthSpread: getUnit(numFromName, 3),
    faceRotate: getUnit(numFromName, 10, 3),
    faceTranslateX: baseFaceTranslateX,
    faceTranslateY: baseFaceTranslateY,
    // Additional params for more variety while keeping friendly expressions
    eyeWidth: 1.5 + getUnit(numFromName, 1, 4) / 2, // eye width 1.5-2
    eyeHeight: 2 + getUnit(numFromName, 1, 5) / 2, // eye height 2-2.5
    eyeY: 14 + getUnit(numFromName, 2, 6) - 1, // eye position 13-15
    mouthY: 19 + getUnit(numFromName, 2, 7) - 1, // mouth position 18-20
    faceScale: 0.95 + getUnit(numFromName, 2, 8) / 10, // face scale 0.95-1.15
    // Wrapper shape variety - soft rounded shapes
    wrapperRadius: wrapperRadius,
  };

  return data;
}
function generateBeamSVG(name, colors, useTitle) {
  const size = 36; // viewBox
  const data = generateBeamData(name, colors, size);
  return `<svg part="svg" viewBox="0 0 ${size} ${size}" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
		${useTitle ? `<title>${name}</title>` : ''}
		<g>
			<rect width="${size}" height="${size}" fill="${data.backgroundColor}" />
			<rect x="0" y="0" width="${size}" height="${size}" transform="translate(${data.wrapperTranslateX} ${data.wrapperTranslateY}) rotate(${data.wrapperRotate} ${size / 2} ${size / 2}) scale(${data.wrapperScale})" fill="${data.wrapperColor}" rx="${data.wrapperRadius}" />
			<g transform="translate(${data.faceTranslateX} ${data.faceTranslateY}) rotate(${data.faceRotate} ${size / 2} ${size / 2}) scale(${data.faceScale})">
				${
          data.isMouthOpen
            ? `<path d="M15 ${data.mouthY + data.mouthSpread}c2 1 4 1 6 0" stroke="${data.faceColor}" fill="none" strokeLinecap="round" />`
            : `<path d="M13,${data.mouthY + data.mouthSpread} a1,0.75 0 0,0 10,0" fill="${data.faceColor}" />`
        }
				<rect x="${14 - data.eyeSpread}" y="${data.eyeY}" width="${data.eyeWidth}" height="${data.eyeHeight}" rx="${data.eyeWidth / 2}" stroke="none" fill="${data.faceColor}" />
				<rect x="${20 + data.eyeSpread}" y="${data.eyeY}" width="${data.eyeWidth}" height="${data.eyeHeight}" rx="${data.eyeWidth / 2}" stroke="none" fill="${data.faceColor}" />
			</g>
		</g>
	</svg>`;
}

/*
 *********** CUSTOM ELEMENT ***********
 */
class PlayfulAvatar extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'variant', 'title', 'colors'];
  }

  constructor() {
    super();
    this._isConnected = false;
    this.attachShadow({ mode: 'open' });
  }

  get name() {
    return this.getAttribute('name');
  }
  set name(value) {
    value ? this.setAttribute('name', value) : this.removeAttribute('name');
  }

  get variant() {
    return this.getAttribute('variant');
  }
  set variant(value) {
    value
      ? this.setAttribute('variant', value)
      : this.removeAttribute('variant');
  }

  get title() {
    return this.hasAttribute('title');
  }
  set title(value) {
    value ? this.setAttribute('title', value) : this.removeAttribute('title');
  }

  get colors() {
    return this.getAttribute('colors');
  }
  set colors(value) {
    value
      ? this.setAttribute('colors', sanitizeColors(value).join(','))
      : this.removeAttribute('colors');
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (this._isConnected && newValue !== oldValue) {
      this.render();
    }
  }

  // see https://web.dev/articles/custom-elements-best-practices#make_properties_lazy
  _upgradeProperty(prop) {
    if (this.hasOwnProperty(prop)) {
      const value = this[prop];
      delete this[prop];
      this[prop] = value;
    }
  }

  connectedCallback() {
    if (!this._isConnected) {
      this._isConnected = true;
      this._upgradeProperty('name');
      this._upgradeProperty('title');
      this._upgradeProperty('colors');
      this.render();
    }
  }

  render() {
    const name = this.getAttribute('name');
    let colors;
    if (this.hasAttribute('colors')) {
      colors = sanitizeColors(this.getAttribute('colors'));
    } else {
      // Select a palette based on username hash
      const paletteIndex = Math.abs(hashCode(name)) % COLOR_PALETTES.length;
      colors = COLOR_PALETTES[paletteIndex];
    }
    const useTitle = this.hasAttribute('title');
    const svg = generateBeamSVG(name, colors, useTitle);

    this.shadowRoot.innerHTML = `<style>
			:host { display: inline-block; line-height: 0;  }
			:host([hidden]) { display: none; }
			svg {
				width: inherit;
				height: inherit;
				border-radius: inherit;
				box-shadow: inherit;
			}
			</style>
			${svg}
		`;
  }
}

// define custom element only if it wasn't defined before
if (!customElements.get('playful-avatar')) {
  customElements.define('playful-avatar', PlayfulAvatar);
}
