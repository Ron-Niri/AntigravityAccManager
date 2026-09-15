const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'));
fs.writeFileSync(path.join(root, 'media', 'icon.png'), new Resvg(svg).render().asPng());
